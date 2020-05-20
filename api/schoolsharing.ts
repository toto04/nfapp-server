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
        text:
            `SELECT id,
                data AS images,
                firstname || ' ' || lastname AS author,
                title,
                description,
                postingdate,
                SUM(CASE
                    WHEN notevotes.positive THEN 1
                    WHEN notevotes.positive=false THEN -1
                    ELSE 0 
                END) as points,
                n.positive as vote 
            FROM notes 
                JOIN users ON "user" = users.username 
                LEFT JOIN notevotes ON notes.id = notevotes.note 
                LEFT JOIN notevotes AS n ON notes.id=n.note AND n.user=$1 
            WHERE id=$2 
            GROUP BY notes.id, users.username, n.positive`,
        values: [req.header('x-nfapp-username'), req.params.id]
    })
    client.release()
    return { success: true, data: note.rows[0] }
}))

ss.route('/notes/:section/:class/:subject/:page*?')
    .get(aw(async (req) => {
        const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
        if (!logged) return { success: false, error: 'invalid credentials' }

        let client = await pool.connect()
        let notes = await client.query({
            text: `SELECT id,
                array_length(data, 1) AS images,
                firstname || ' ' || lastname AS author,
                title,
                description,
                postingdate,
                SUM(CASE
                    WHEN notevotes.positive THEN 1
                    WHEN notevotes.positive=false THEN -1
                    ELSE 0 
                END) as points,
                n.positive as vote
            FROM notes 
                JOIN users ON "user" = users.username 
                LEFT JOIN notevotes ON notes.id = notevotes.note 
                LEFT JOIN notevotes AS n ON notes.id=n.note AND n.user=$5
            WHERE section = $1 AND notes.class = $2 AND subject = $3
            GROUP BY notes.id, users.username, n.positive
            ORDER BY points DESC LIMIT 10 OFFSET $4`,
            values: [req.params.section, req.params.class, req.params.subject, (parseInt(req.params.page ?? '0')) * 10, req.header('x-nfapp-username')]
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
            return { success: false, error: e.message }
        } finally {
            client.release()
        }
    }))

ss.post('/vote/:note', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    let client = await pool.connect()
    if (req.body.vote == undefined) await client.query({
        text: 'DELETE FROM notevotes WHERE "user"=$1 AND note=$2',
        values: [req.header('x-nfapp-username'), req.params.note]
    })
    else await client.query({
        text: 'INSERT INTO notevotes VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT notevotes_pkey DO UPDATE SET positive=$3',
        values: [req.header('x-nfapp-username'), req.params.note, req.body.vote]
    })
    client.release()
    return { success: true }
}))

ss.get('/notes/:user', aw(async (req) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) return { success: false, error: 'invalid credentials' }

    let client = await pool.connect()
    let notes = await client.query({
        text: 'SELECT id, array_length(data, 1) AS images, firstname || \' \' || lastname AS author, title, description, postingdate, section, notes.class, subject  FROM notes JOIN users ON "user" = users.username WHERE "user" = $1 ORDER BY postingdate',
        values: [req.header('x-nfapp-username')]
    })
    client.release()

    for (let row of notes.rows) {
        let imgCount = row.images
        row.images = []
        for (let i = 1; i <= imgCount; i++) row.images.push(`/api/schoolsharing/note/${row.id}/${i}.jpg`)
    }
    return { success: true, data: notes.rows }
}))


export default ss