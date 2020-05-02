import { Router } from 'express'
import session from 'express-session'
import { pool, login, aw } from './util'
import request from 'request-promise'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env') })

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
    if (!req.session?.logged) return { success: false, error: 'invalid session, please log in' }
    return { success: false }
}))

privatearea.post('/event', aw(async req => {
    return { success: false }
}))

export default privatearea