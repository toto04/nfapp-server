import { Router } from 'express'
import session from 'express-session'
import { pool, aw } from './util'
import request from 'request-promise'
import dotenv from 'dotenv'
import path from 'path'
import Expo from 'expo-server-sdk'
dotenv.config({ path: path.join(__dirname, '../.env') })
let expo = new Expo()

type NotificationData = {
    type: 'newPost',
    postID: number
} | {
    type: 'newEvent',
    eventDate: string
} | {
    type: 'newSurvey'
}

let privatearea = Router()
if (!process.env.COOKIE_SECRET) throw new Error('COOKIE_SECRET env must be set')
privatearea.use(session({
    secret: process.env.COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}))

privatearea.get('/check', aw(async req => {
    return { success: !!req.session?.logged }
}))

privatearea.post('/login', aw(async req => {
    if (!req.session) throw new Error('Session uninitialized, how tho')
    req.session.logged = false
    let r = await request({
        uri: 'https://www.google.com/recaptcha/api/siteverify',
        method: 'post',
        form: {
            secret: process.env.RECAPTCHA_SECRET,
            response: req.body.recaptchaToken
        }
    }).promise()
    let response = JSON.parse(r)
    if (!response.success) return { success: false, error: 'Captcha non valido' }
    if (req.body.password === process.env.PRIVATEAREA_PASSWORD) {
        req.session.logged = true
        return { success: true }
    } else return { success: false, error: 'password non valida' }
}))

privatearea.post('/post', aw(async req => {
    if (!req.session?.logged) return { success: false, error: 'invalid session, please log in (ricarica la pagina)' }
    if (!req.body.title) return { success: false, error: 'post title must be provided' }
    if (!req.body.author) return { success: false, error: 'post author must be provided' }
    let client = await pool.connect()
    try {
        let res = await client.query({
            text: 'INSERT INTO posts (title, author, body, image) VALUES ($1, $2, $3, $4) RETURNING "id"',
            values: [req.body.title, req.body.author, req.body.description, req.body.image]
        })
        sendNotification('È stato pubblicato un nuovo post!', { type: 'newPost', postID: res.rows[0].id }, req.body.title)
        return { success: true }
    } catch (e) {
        return { success: false, error: e.message }
    } finally {
        client.release()
    }
}))

privatearea.post('/event', aw(async req => {
    if (!req.session?.logged) return { success: false, error: 'invalid session, please log in (ricarica la pagina)' }
    if (!req.body.title) return { success: false, error: 'post title must be provided' }
    if (!req.body.start) return { success: false, error: 'post start datetime must be provided' }
    if (!req.body.end) return { success: false, error: 'post end datetime must be provided' }
    let client = await pool.connect()
    try {
        await client.query({
            text: 'INSERT INTO events ("start", "end", "title", "body") VALUES ($1, $2, $3, $4)',
            values: [req.body.start, req.body.end, req.body.title, req.body.description]
        })
        sendNotification('C\'è un nuovo evento nel calendario!', { type: 'newEvent', eventDate: req.body.start.split(' ')[0] }, req.body.title + ', ' + dateMessage(new Date(req.body.start)))
        return { success: true }
    } catch (e) {
        return { success: false, error: e.message }
    } finally {
        client.release()
    }
}))

function dateMessage(date: Date): string {
    let hformat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
    return `il ${date.getDate()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()} alle ${hformat.format(date)}`
}

async function sendNotification(title: string, data: NotificationData, body?: string) {
    let client = await pool.connect()
    let tokens = await client.query({
        text: 'SELECT token FROM "notificationTokens" WHERE CURRENT_TIMESTAMP - lastupdated < interval \'30 days\'' + ((data.type == 'newSurvey') ? ' AND "user" IS NOT NULL' : '')
    })
    let chunks = expo.chunkPushNotifications(tokens.rows.map(({ token }) => ({
        to: token,
        sound: 'default',
        data,
        title,
        body
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
}

export default privatearea