import crypto from 'crypto'
import path from 'path'
import sg from '@sendgrid/mail'
import ejs from 'ejs'
import { Router } from 'express'
import { aw, pool, login } from './util'

let recovery = Router()
sg.setApiKey(process.env.SG_API_KEY ?? '')

let tokens: { [token: string]: string } = {}

recovery.post('/email', aw(async req => {
    if (!req.body.email) return { success: false, error: 'an email must be provided' }
    let client = await pool.connect()
    let q = await client.query({
        text: 'SELECT username FROM users WHERE email=$1',
        values: [req.body.email]
    })
    client.release()
    if (q.rowCount) {
        let token = genToken()
        tokens[token] = q.rows[0].username
        setTimeout(() => { delete tokens[token] }, 60 * 60 * 1000)
        sg.send({
            to: req.body.email,
            from: 'NFApp - Liceo Nervi Ferrari <nfapp@example.com>',
            subject: 'Recupero password',
            html: await ejs.renderFile(path.join(__dirname, '../../template.ejs'), { token })
        })
        return { success: true }
    }
    else return { success: false, error: 'invalid email' }
}))

recovery.get('/check/:token', aw(async req => {
    return { success: !!tokens[req.params.token] }
}))

recovery.post('/reset', aw(async req => {
    if (!tokens[req.body.token]) return { success: false, error: 'invalid token' }
    if (!req.body.password) return { success: false, error: 'a password must be provided' }
    let client = await pool.connect()
    let hash = crypto.createHash('sha256')
    hash.update(req.body.password ?? '')
    await client.query({
        text: 'UPDATE users SET password=$1 WHERE username=$2',
        values: [hash.digest('hex'), tokens[req.body.token]]
    })
    client.release()
    delete tokens[req.body.token]
    return { success: true }
}))

function genToken(): string {
    let buff = crypto.randomBytes(16)
    let t = buff.toString('hex')
    if (tokens[t]) return genToken()
    else return t
}

export default recovery