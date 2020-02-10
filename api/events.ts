import { Router } from 'express'
import { aw, pool } from './util'

let events = Router()

events.get('/', aw(async (req) => {
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT to_char(date + INTERVAL\'1 hour\', \'yyyy-mm-dd\') AS date, description FROM events'
    })
    client.release()
    return { success: true, data: result.rows }
}))

export default events