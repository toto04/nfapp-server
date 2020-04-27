import { Router } from 'express'
import { aw, pool, login } from './util'
import { QueryResult } from 'pg'

let events = Router()

events.get('/', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    let client = await pool.connect()
    let query: Promise<QueryResult<{
        id: number,
        start: Date,
        end: Date,
        title: string,
        body: string,
        partecipates?: boolean
    }>>
    if (logged) {
        query = client.query({
            text: `SELECT 
                id, 
                "start", 
                "end", 
                title, 
                body,
                CASE
                    WHEN pa.user IS NOT NULL THEN TRUE
                    ELSE FALSE
                END AS partecipates
            FROM events
            LEFT JOIN partecipations AS pa 
                ON events.id = pa.event 
                AND pa.user = 'tommaso.morganti'`
        })
    } else {
        query = client.query({
            text: 'SELECT id, "start", "end", title, body FROM events'
        })
    }
    let result = await query
    client.release()
    return { success: true, data: result.rows }
}))

events.get('/partecipations', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    const client = await pool.connect()
    let result = await client.query({
        text: `SELECT id, "start", "end", title, body, TRUE as partecipates
        FROM partecipations AS pa JOIN events ON pa.event = events.id
        WHERE pa.user = $1`,
        values: [req.header('x-nfapp-username')]
    })
    client.release()
    return { success: true, data: result.rows }
}))

events.post('/setPartecipation/:event', aw(async req => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }
    if (typeof req.body.partecipates != "boolean") return { success: false, error: '"partecipates" field must be set to either true or false' }

    const client = await pool.connect()
    try {
        let query: Promise<QueryResult<any>>
        if (req.body.partecipates) {
            query = client.query({
                text: 'INSERT INTO partecipations VALUES ($1, $2)',
                values: [req.header('x-nfapp-username'), req.params.event]
            })
        } else {
            query = client.query({
                text: 'DELETE FROM partecipations WHERE "user"=$1 AND event=$2',
                values: [req.header('x-nfapp-username'), req.params.event]
            })
        }
        await query
        return { success: true }
    } catch (e) {
        return { success: false, error: e.detail }
    } finally {
        client.release()
    }
}))
export default events