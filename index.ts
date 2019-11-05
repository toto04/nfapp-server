import express from 'express'
import { Pool, QueryConfig } from 'pg'
import crypto from 'crypto'
require('dotenv').config()
const app = express()
app.use(express.json())

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
})

app.post('/api/login', (req, res) => {
    pool.connect().then(async client => {
        const query: QueryConfig = {
            text: 'SELECT * FROM users WHERE username = $1',
            values: [req.body.usr]
        }
        const result = await client.query(query)
        let hash = crypto.createHash('sha256')
        hash.update(req.body.pwd)
        if (!result.rows[0]) res.end()
        else res.send({
            logged: result.rows[0].password == hash.digest('hex')
        })
    })
})
app.post('/api/signup', (req, res) => {
    pool.connect().then(async client => {
        let hash = crypto.createHash('sha256')
        hash.update(req.body.pwd)
        const query: QueryConfig = {
            text: 'INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6, 3)',
            values: [req.body.usr, hash.digest('hex'), 'ciao@example.com', 'Giovanni', 'Però', '6ASA']
        }
        const result = await client.query(query)
        console.log(result)
    })
})

app.listen(process.env.PORT || 2001)


