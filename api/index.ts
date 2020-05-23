import express, { Router } from 'express'
import crypto from 'crypto'
import { pool, login, aw } from './util'
export { pool } from './util'
import { QueryConfig } from 'pg'

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