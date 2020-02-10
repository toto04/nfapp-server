import { Router } from 'express'
import { aw, pool, login } from './util'

let posts = Router()

posts.get('/postDetail/:id', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    let client = await pool.connect()
    try {
        let result = await client.query({
            text: 'SELECT * FROM posts WHERE id = $1',
            values: [req.params.id]
        })
        if (result.rowCount == 0) throw new Error()
        let post = result.rows[0]

        if (logged) {
            let likes = await client.query({
                text: 'SELECT * FROM likes WHERE "user"=$1 AND post=$2',
                values: [req.header('x-nfapp-username'), post.id]
            })
            post.liked = likes.rowCount == 1
        }
        return { success: true, data: post }
    } catch (e) {
        return { success: false, error: 'invalid post id' }
    } finally {
        client.release()
    }
}))

posts.get('/:page(\\d+)?', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    let page = req.params.page ? parseInt(req.params.page) : 0
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT id, author, title, body, image, time, COUNT("user") as likes FROM posts LEFT JOIN likes ON likes.post = posts.id GROUP BY (posts.id) ORDER BY time DESC LIMIT 10 OFFSET $1',
        values: [page * 10]
    })

    if (logged) {
        let queries = []
        for (const post of result.rows) queries.push(client.query({
            text: 'SELECT * FROM likes WHERE "user"=$1 AND post=$2',
            values: [req.header('x-nfapp-username'), post.id]
        }))
        let likes = await Promise.all(queries)
        for (let i = 0; i < result.rowCount; i++) result.rows[i].liked = likes[i].rowCount != 0
    }

    client.release()
    return { success: true, data: result.rows }
}))

posts.post('/like/:post', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    const client = await pool.connect()
    try {
        await client.query({
            text: 'INSERT INTO likes VALUES ($1, $2)',
            values: [req.header('x-nfapp-username'), req.params.post]
        })
        return { success: true }
    } catch (e) {
        return { success: false, error: e.detail }
    } finally {
        client.release()
    }
}))

posts.post('/dislike/:post', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    const client = await pool.connect()
    try {
        await client.query({
            text: 'DELETE FROM likes WHERE "user"=$1 AND post=$2',
            values: [req.header('x-nfapp-username'), req.params.post]
        })
        return { success: true }
    } catch (e) {
        return { success: false, error: e.detail }
    } finally {
        client.release()
    }
}))

export default posts