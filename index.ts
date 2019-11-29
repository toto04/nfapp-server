import express from 'express'
import session from 'express-session'
import { Pool, QueryConfig, QueryResult } from 'pg'
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

app.get('/api/surveys/:user*?', async (req, res) => {
    let client = await pool.connect()
    let result = await client.query({ // normal query to get the available events
        text: 'SELECT name, fields, expiry FROM surveys WHERE available=TRUE'
    })
    let surveys = result.rows
    if (req.params.user) {  // filter already answered surveys by username
        let queries: Promise<QueryResult<any>>[] = []
        for (let survey of surveys) {   // for each survey query the respective table
            queries.push(client.query({
                text: `SELECT * FROM "${survey.name}" WHERE username = $1`,
                values: [req.params.user]
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
    let hash = crypto.createHash('sha256')
    hash.update(req.body.password ? req.body.password : '')
    let loginQuery = await client.query({
        text: 'SELECT * FROM users WHERE username=$1 AND password=$2',
        values: [req.body.username, hash.digest('hex')]
    })
    if (loginQuery.rows.length == 0) {
        res.send({ success: false, error: 'Credenziali sbagliate' })
        return
    }

    let result = await client.query({
        text: 'SELECT fields FROM surveys WHERE name=$1',
        values: [req.params.survey]
    })
    let fields = Object.keys(result.rows[0].fields)
    let valNumbers: string[] = ['$1']
    let answers: string[] = [req.body.username]
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


