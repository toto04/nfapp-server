import crypto from 'crypto'
import { Router } from 'express'
import { aw, pool, login } from './util'

let user = Router()

user.get('/info/:username', aw(async (req) => {
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT firstname, lastname, class, role, profilepic FROM users WHERE username=$1',
        values: [req.params.username]
    })
    client.release()
    return {
        success: true,
        data: {
            firstName: result.rows[0].firstname,
            lastName: result.rows[0].lastname,
            classname: result.rows[0].class,
            role: result.rows[0].role,
            profilepic: result.rows[0].profilepic ?? undefined
        }
    }
}))

user.post('/profilepic', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (!req.body.profilepic) return { success: false, error: 'a profilepic must be provided' }
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET profilepic=$1 WHERE username=$2',
        values: [req.body.profilepic, req.header('x-nfapp-username')]
    })
    client.release()
    return { success: true }
}))

user.post('/removeProfilepic', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET profilepic=NULL WHERE username=$1',
        values: [req.header('x-nfapp-username')]
    })
    client.release()
    return { success: true }
}))

user.post('/changeName', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (!req.body.firstname || !req.body.lastname) return { success: false, error: 'both firstname and lastname must be provided' }
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET firstname=$2, lastname=$3 WHERE username=$1',
        values: [req.header('x-nfapp-username'), req.body.firstname, req.body.lastname]
    })
    client.release()
    return { success: true }
}))

user.post('/changeClass', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (!req.body.classname) return { success: false, error: 'classname must be provided' }
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET class=$2 WHERE username=$1',
        values: [req.header('x-nfapp-username'), req.body.classname]
    })
    client.release()
    return { success: true }
}))

user.post('/changePassword', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (!req.body.newPassword) return { success: false, error: 'a newPassword must be provided' }
    let hash = crypto.createHash('sha256')
    hash.update(req.body.newPassword)
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET password=$2 WHERE username=$1',
        values: [req.header('x-nfapp-username'), hash.digest('hex')]
    })
    client.release()
    return { success: true }
}))

user.post('/changeEmail', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (!req.body.newEmail) return { success: false, error: 'a newEmail must be provided' }
    let client = await pool.connect()
    await client.query({
        text: 'UPDATE users SET email=$2 WHERE username=$1',
        values: [req.header('x-nfapp-username'), req.body.newEmail]
    })
    client.release()
    return { success: true }
}))

export default user