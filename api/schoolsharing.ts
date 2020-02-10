import { Router } from 'express'
import { aw, login, pool, pw } from './util'

let ss = Router()

ss.get('/note/:postID/(:imageIndex).jpg', pw(async (req, res) => {
    // This route serves the images as raw jpeg, with warning image on error
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT data[$1] AS image FROM notes WHERE id=$2',
        values: [req.params.imageIndex, req.params.postID]
    })
    client.release()
    try {
        let base64 = result.rows[0].image.split(',').pop()
        res.send(Buffer.from(base64, 'base64'))
    } catch (e) {
        res.status(404).sendFile(__dirname + '/static/warn.jpg')
    }
}))

ss.get('/note/:id', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    let client = await pool.connect()
    let note = await client.query({
        text: 'SELECT id, firstname || \' \' || lastname AS author, title, description, postingdate, data AS images FROM notes JOIN users ON "user" = users.username WHERE id = $1',
        values: [req.params.id]
    })
    client.release()
    return { success: true, data: note.rows[0] }
}))

ss.route('/notes/:section/:class/:subject/:page*?')
    .get(aw(async (req) => {
        // TODO: limit posts with pages
        const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
        if (!logged) return { success: false, error: 'invalid credentials' }

        let client = await pool.connect()
        let notes = await client.query({
            text: 'SELECT id, array_length(data, 1) AS images, firstname || \' \' || lastname AS author, title, description, postingdate FROM notes JOIN users ON "user" = users.username WHERE section = $1 AND notes.class = $2 AND subject = $3 ORDER BY postingdate LIMIT 10 OFFSET $4',
            values: [req.params.section, req.params.class, req.params.subject, (parseInt(req.params.page ?? '0')) * 10]
        })
        client.release()

        for (let row of notes.rows) {
            let imgCount = row.images
            row.images = []
            for (let i = 1; i <= imgCount; i++) row.images.push(`/api/schoolsharing/note/${row.id}/${i}.jpg`)
        }
        return { success: true, data: notes.rows }
    }))
    .post(aw(async (req) => {
        const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
        if (!logged) return { success: false, error: 'invalid credentials' }

        let client = await pool.connect()
        try {
            await client.query({
                text: 'INSERT INTO notes ("section", "class", "subject", "user", "title", "description", "data") VALUES ($1, $2, $3, $4, $5, $6, $7)',
                values: [req.params.section, req.params.class, req.params.subject, req.header('x-nfapp-username'), req.body.title, req.body.description, req.body.images]
            })
            return { success: true }
        } catch (e) {
            return { success: false }
        } finally {
            client.release()
        }
    }))



export default ss