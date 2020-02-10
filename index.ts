import express, { NextFunction } from 'express'
import Expo from 'expo-server-sdk'
import { Pool, QueryConfig, QueryResult, Query } from 'pg'
import crypto from 'crypto'
require('dotenv').config()
let expo = new Expo()

const app = express()
app.use(express.json({ limit: '10mb' }))

let connectionOptions = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: true }
    : {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    }
const pool = new Pool(connectionOptions)

async function login(username: string = '', password: string = ''): Promise<boolean> {
    const client = await pool.connect()
    const response = await client.query({
        text: 'SELECT * FROM users WHERE username=$1',
        values: [username]
    })
    client.release()
    const hash = crypto.createHash('sha256')
    hash.update(password)

    return response.rowCount != 0 && response.rows[0].password == hash.digest('hex')
}

app.post('/api/registertoken', async (req, res) => {
    if (!Expo.isExpoPushToken(req.body.token)) {
        res.send({ success: false, error: 'invalid token' })
        return
    }
    let client = await pool.connect()
    await client.query({
        text: 'INSERT INTO notificationtokens VALUES ($1) ON CONFLICT (token) DO UPDATE SET lastupdated = CURRENT_TIMESTAMP',
        values: [req.body.token]
    })
    res.send({ success: true })
    if (await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))) client.query({
        text: 'UPDATE notificationtokens SET "user" = $1 WHERE token = $2',
        values: [req.header('x-nfapp-username'), req.body.token]
    })
    client.release()
})

app.post('/error/:message', (req, res) => {
    throw new Error(req.params.message)
})

app.post('/api/notification', async (req, res) => {
    if (!req.body.title) {
        res.send({ success: false, error: 'a title must be provided' })
        return
    }

    let data: { type: string, postID?: number }
    switch (req.body.type) {
        case 'newPost':
            if (!req.body.postID) {
                res.send({ success: false, error: 'a postID must be provided for type "newPost"' })
                return
            }
            data = { type: 'newPost', postID: req.body.postID }
            break
        default:
            data = { type: req.body.type }
    }

    let client = await pool.connect()
    let tokens = await client.query({
        text: 'SELECT token FROM notificationtokens WHERE CURRENT_TIMESTAMP - lastupdated < interval \'30 days\'' + ((data.type == 'newSurvey') ? ' AND "user" IS NOT NULL' : '')
    })
    let chunks = expo.chunkPushNotifications(tokens.rows.map(({ token }) => ({
        to: token,
        sound: 'default',
        data,
        title: req.body.title,
        body: req.body.body
    })))
    let tickets = []
    for (let chunk of chunks) {
        try {
            tickets.push(...await expo.sendPushNotificationsAsync(chunk))
        } catch (e) { console.error(e) }
    }
    res.send({ success: true })
    await client.query({
        text: 'INSERT INTO tickets VALUES ($1)',
        values: [JSON.stringify(tickets)]
    })
    client.release()
})

app.post('/api/login', async (req, res) => {
    let logged = await login(req.body.usr, req.body.pwd)
    if (logged) {
        let client = await pool.connect()
        let result = await client.query({
            text: 'SELECT * FROM users WHERE username=$1',
            values: [req.body.usr]
        })
        client.release()
        res.send({
            logged,
            username: req.body.usr,
            password: req.body.pwd,
            classname: result.rows[0].class,
            firstName: result.rows[0].firstname,
            lastName: result.rows[0].lastname
        })
    } else res.send({ logged })
})

app.post('/api/signup', (req, res) => {
    pool.connect().then(async client => {
        let hash = crypto.createHash('sha256')
        hash.update(req.body.pwd ? req.body.pwd : '')
        const query: QueryConfig = {
            text: 'INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)',
            values: [req.body.usr, hash.digest('hex'), req.body.email, req.body.fstName, req.body.lstName, req.body.cls]
        }
        try {
            await client.query(query)
            res.send({ success: true })
        } catch (e) {
            res.send({ success: false, error: e.detail })
        } finally {
            client.release()
        }
    })
})

app.get('/api/user/:username', async (req, res) => {
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT firstname, lastname, class, role FROM users WHERE username=$1',
        values: [req.params.username]
    })
    client.release()
    res.send(result.rows[0])
})

app.get('/api/post/:id', async (req, res) => {
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

        client.release()
        res.send(post)
    } catch (e) {
        res.send({ success: false, error: 'invalid post id' })
    }
})

app.get('/api/posts/:page*?', async (req, res) => {
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
    res.send(result.rows)
})

app.post('/api/like/:post', async (req, res) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) {
        res.send({ success: false, error: 'invalid credentials' })
        return
    }

    const client = await pool.connect()
    try {
        await client.query({
            text: 'INSERT INTO likes VALUES ($1, $2)',
            values: [req.header('x-nfapp-username'), req.params.post]
        })
        res.send({ success: true })
    } catch (e) {
        res.send({ success: false, error: e.detail })
    } finally {
        client.release()
    }
})

app.post('/api/dislike/:post', async (req, res) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) {
        res.send({ success: false, error: 'invalid credentials' })
        return
    }

    const client = await pool.connect()
    try {
        await client.query({
            text: 'DELETE FROM likes WHERE "user"=$1 AND post=$2',
            values: [req.header('x-nfapp-username'), req.params.post]
        })
        res.send({ success: true })
    } catch (e) {
        res.send({ success: false, error: e.detail })
    } finally {
        client.release()
    }
})

app.get('/api/surveys', async (req, res) => {
    let client = await pool.connect()
    let result = await client.query({ // normal query to get the available events
        text: 'SELECT name, fields, expiry FROM surveys WHERE available=TRUE'
    })
    let surveys = result.rows
    if (req.header('x-nfapp-username')) {  // filter already answered surveys by username
        let queries = []
        for (let survey of surveys) {   // for each survey query the respective table
            queries.push(client.query({
                text: `SELECT * FROM "${survey.name}" WHERE username = $1`,
                values: [req.header('x-nfapp-username')]
            }))
        }
        let availableSurveys = await Promise.all(queries)   // await all the queries
        // filter out the queries with the answers from the user
        surveys = surveys.filter((v, i) => availableSurveys[i].rows.length == 0)
    }
    client.release()
    res.send(surveys)
})

app.post('/api/surveys/:survey', async (req, res) => {
    let client = await pool.connect()

    //login
    let username = req.header('x-nfapp-username') || '', password = req.header('x-nfapp-password') || ''
    if (!await login(username, password)) {
        res.send({ success: false, error: 'Credenziali sbagliate' })
        return
    }

    let result = await client.query({
        text: 'SELECT fields FROM surveys WHERE name=$1',
        values: [req.params.survey]
    })
    let fields = Object.keys(result.rows[0].fields)
    let valNumbers: string[] = ['$1']
    let answers: string[] = [username]
    for (let i = 0; i < fields.length; i++) {
        valNumbers.push('$' + (i + 2))
        answers.push(req.body.answers[fields[i]])
    }
    try {
        await client.query({
            text: `INSERT INTO "${req.params.survey}" (username, ${fields.join(', ')}) VALUES (${valNumbers.join(', ')})`,
            values: answers
        })
        res.send({ success: true })
    } catch (e) {
        if (e.message.includes('duplicate')) res.send({ success: false, error: 'Hai già risposto a questo sondaggio' })
        else res.send({ success: false, error: 'Non esiste questo sondaggio' })
    } finally {
        client.release()
    }
})

app.get('/api/events', (req, res) => {
    pool.connect().then(async client => {
        let result = await client.query({
            text: 'SELECT to_char(date + INTERVAL\'1 hour\', \'yyyy-mm-dd\') AS date, description FROM events'
        })
        client.release()
        res.send(result.rows)
    })
})

app.get('/api/schoolsharing/note/:postID/(:imageIndex).jpg', async (req, res) => {
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
})

app.get('/api/schoolsharing/note/:id', async (req, res) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    if (!logged) {
        res.send({ success: false, error: 'invalid credentials' })
        return
    }

    let client = await pool.connect()
    let note = await client.query({
        text: 'SELECT id, firstname || \' \' || lastname AS author, title, description, postingdate, data AS images FROM notes JOIN users ON "user" = users.username WHERE id = $1',
        values: [req.params.id]
    })
    client.release()
    res.send(note.rows[0])
})

app.route('/api/schoolsharing/notes/:section/:class/:subject/:page*?')
    .get(async (req, res) => {
        // TODO: limit posts with pages
        const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
        if (!logged) {
            res.send({ success: false, error: 'invalid credentials' })
            return
        }
        let client = await pool.connect()
        let notes = await client.query({
            text: 'SELECT id, array_length(data, 1) AS images, firstname || \' \' || lastname AS author, title, description, postingdate FROM notes JOIN users ON "user" = users.username WHERE section = $1 AND notes.class = $2 AND subject = $3 ORDER BY postingdate LIMIT 10 OFFSET $4',
            values: [req.params.section, req.params.class, req.params.subject, (parseInt(req.params.page ?? 0)) * 10]
        })
        client.release()

        for (let row of notes.rows) {
            let imgCount = row.images
            row.images = []
            for (let i = 1; i <= imgCount; i++) row.images.push(`/api/schoolsharing/note/${row.id}/${i}.jpg`)
        }
        res.send(notes.rows)
    })
    .post(async (req, res) => {
        const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
        if (!logged) {
            res.send({ success: false, error: 'invalid credentials' })
            return
        }
        let client = await pool.connect()
        try {
            await client.query({
                text: 'INSERT INTO notes ("section", "class", "subject", "user", "title", "description", "data") VALUES ($1, $2, $3, $4, $5, $6, $7)',
                values: [req.params.section, req.params.class, req.params.subject, req.header('x-nfapp-username'), req.body.title, req.body.description, req.body.images]
            })
            res.send({ success: true })
        } catch (e) {
            res.send({ success: false })
        } finally {
            client.release()
        }
    })

// 404 error handler
app.use((req, res, next) => {
    res.status(404).send({ success: false, error: '404, invalid endpoint' })
})

// Internal server error handler, for when something brakes
app.use((err: Error, req: express.Request, res: express.Response, next: NextFunction) => {
    let requestInfo = { method: req.method, ip: req.ip, url: req.originalUrl, body: req.body, username: req.header('x-nfapp-username') }
    console.error(`\x1b[31m[ERROR HANDLER] An error occurred at time: ${new Date(Date.now())}\nError:\x1b[0m`, err, `\n\n\x1b[31mRequest: \x1b[0m`, requestInfo)
    res.status(500).send({ success: false, error: '500, internal server error', details: { error: { name: err.name, message: err.message, stack: err.stack }, request: requestInfo } })
})

app.listen(process.env.PORT || 2001, () => {
    console.log('server listening on port', process.env.PORT)
})