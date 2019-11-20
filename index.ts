import express from 'express'
import session from 'express-session'
import { Pool, QueryConfig } from 'pg'
import crypto from 'crypto'
require('dotenv').config()
const app = express()
app.use(session({
    name: 'nfapp_cookie',
    secret: 'eliaculo',
    resave: false,
    saveUninitialized: false
}))
app.use(express.json())

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
})

app.get('/', (req, res) => {
    // session test, ignore
    console.log(req.session)
    if (!req.session) {
        res.send('no')
        return
    }
    if (req.session.count == undefined) {
        req.session.count = 0
    } else {
        req.session.count++
    }
    res.json(req.session.count)
})

app.post('/api/login', (req, res) => {
    pool.connect().then(async client => {
        const query: QueryConfig = {
            text: 'SELECT * FROM users WHERE username = $1',
            values: [req.body.usr]
        }
        const result = await client.query(query)
        client.release()
        let hash = crypto.createHash('sha256')
        hash.update(req.body.pwd)
        if (!result.rows[0]) res.send({
            logged: false
        })
        else res.send({
            logged: result.rows[0].password == hash.digest('hex'),
            username: req.body.usr,
            password: req.body.pwd,
            firstName: result.rows[0].firstname,
            lastName: result.rows[0].lastname
        })
    })
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

app.get('/api/events', (req, res) => {
    console.log('responding')
    pool.connect().then(async client => {
        console.log('database')
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


