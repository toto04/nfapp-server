import express from 'express'
import session from 'express-session'
import { Pool, QueryConfig, QueryResult } from 'pg'
import crypto from 'crypto'
require('dotenv').config()

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

const app = express()
app.use(express.json())

let connectionOptions = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: true }
    : {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    }
const pool = new Pool(connectionOptions)

app.get('/', (req, res) => {
    res.send('no elia, non ancora')
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

app.get('/api/posts/:page*?', async (req, res) => {
    const logged = await login(req.header('x-nfapp-username'), req.header('x-nfapp-password'))
    let page = req.params.page ? parseInt(req.params.page) : 0
    let client = await pool.connect()
    let result = await client.query({
        text: 'SELECT * FROM posts ORDER BY time DESC LIMIT 10 OFFSET $1',
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

app.listen(process.env.PORT || 2001, () => {
    console.log('server listening', process.env.PORT)
})