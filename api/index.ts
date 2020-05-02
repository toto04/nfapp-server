import express, { Router } from 'express'
import crypto from 'crypto'
import { pool, login, aw } from './util'
import Expo from 'expo-server-sdk'
import { QueryConfig } from 'pg'
let expo = new Expo()

let api = Router()
api.use(express.json({ limit: '10mb' }))

import user from './user'
import posts from './posts'
import surveys from './surveys'
import events from './events'
import ss from './schoolsharing'
import privatearea from './privatearea'
api.use('/user', user)
api.use('/posts', posts)
api.use('/surveys', surveys)
api.use('/events', events)
api.use('/schoolsharing', ss)
api.use('/privatearea', privatearea)

api.post('/registertoken', aw(async (req) => {
    if (!Expo.isExpoPushToken(req.body.token)) return { success: false, error: 'invalid token' }
    let client = await pool.connect()
    await client.query({
        text: 'INSERT INTO notificationtokens VALUES ($1) ON CONFLICT (token) DO UPDATE SET lastupdated = CURRENT_TIMESTAMP',
        values: [req.body.token]
    })
    if (await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))) client.query({
        text: 'UPDATE notificationtokens SET "user" = $1 WHERE token = $2',
        values: [req.header('x-nfapp-username'), req.body.token]
    })
    client.release()
    return { success: true }
}))

api.post('/notification', aw(async (req) => {
    //TODO: admin verification
    if (!req.body.title) return { success: false, error: 'a title must be provided' }

    let data: { type: string, postID?: number }
    switch (req.body.type) {
        case 'newPost':
            if (!req.body.postID) return { success: false, error: 'a postID must be provided for type "newPost"' }
            data = { type: 'newPost', postID: req.body.postID }
            break
        default:
            data = { type: req.body.type }
    }

    let client = await pool.connect()
    let tokens = await client.query({
        text: 'SELECT token FROM notificationtokens WHERE CURRENT_TIMESTAMP - lastupdated < interval \'30 days\'' + ((data.type == 'newSurvey') ? ' AND "user" IS NOT NULL' : '')
    })
    let chunks = expo.chunkPushNotifications(tokens.rows.map(({ token }) => ({
        to: token,
        sound: 'default',
        data,
        title: req.body.title,
        body: req.body.body
    })))
    let tickets = []
    for (let chunk of chunks) {
        try {
            tickets.push(...await expo.sendPushNotificationsAsync(chunk))
        } catch (e) { console.error(e) }
    }
    await client.query({
        text: 'INSERT INTO tickets VALUES ($1)',
        values: [JSON.stringify(tickets)]
    })
    client.release()
    return { success: true }
}))

/* USER ENDPOINTS */

api.post('/login', aw(async (req) => {
    let logged = await login(req.body.usr, req.body.pwd)
    if (logged) {
        let client = await pool.connect()
        let result = await client.query({
            text: 'SELECT * FROM users WHERE username=$1',
            values: [req.body.usr]
        })
        client.release()
        return {
            success: true,
            data: {
                username: req.body.usr,
                password: req.body.pwd,
                classname: result.rows[0].class,
                firstName: result.rows[0].firstname,
                lastName: result.rows[0].lastname,
                profilepic: result.rows[0].profilepic
            }
        }
    } else return { success: false, error: 'Invalid credentials' }
}))

api.post('/signup', aw(async (req) => {
    let client = await pool.connect()
    let hash = crypto.createHash('sha256')
    hash.update(req.body.pwd ? req.body.pwd : '')
    const query: QueryConfig = {
        text: 'INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)',
        values: [req.body.usr, hash.digest('hex'), req.body.email, req.body.fstName, req.body.lstName, req.body.cls]
    }
    try {
        await client.query(query)
        return { success: true }
    } catch (e) {
        return { success: false, error: e.detail }
    } finally {
        client.release()
    }
}))

export default api