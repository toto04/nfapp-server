import express, { NextFunction } from 'express'
import helmet from 'helmet'
import path from 'path'
import api from './api'
require('dotenv').config()

const app = express()

app.use(helmet())
app.set('trust proxy', 1)
app.use('/api', api)
app.use(express.static(path.join(__dirname + '../../static'), {
    extensions: ['html']
}))

app.post('/error/:message', (req, res) => {
    throw new Error(req.params.message)
})

// 404 error handler
app.use((req, res, next) => {
    res.status(404).send({ success: false, error: '404, invalid endpoint' })
})

// Internal server error handler, for when something brakes
app.use((err: Error, req: express.Request, res: express.Response, next: NextFunction) => {
    let body = req.body
    for (const key in body) {
        if (typeof body[key] == "string" && body[key].length > 100) body[key] = body[key].substr(0, 100) + '... [truncated to first 100 characters]'
    }
    let requestInfo = { method: req.method, ip: req.ip, url: req.originalUrl, body: req.body, username: req.header('x-nfapp-username') }
    console.error(`\x1b[31m[ERROR HANDLER] An error occurred at time: ${new Date(Date.now())}\nError:\x1b[0m`, err, `\n\n\x1b[31mRequest: \x1b[0m`, requestInfo)
    res.status(500).send({ success: false, error: '500, internal server error', details: { error: { name: err.name, message: err.message, stack: err.stack }, request: requestInfo } })
})

app.listen(process.env.PORT || 2001, () => {
    console.log('server listening on port', process.env.PORT)
})