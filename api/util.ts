import { Request, Response, NextFunction, RequestHandler } from 'express'
import { Pool } from 'pg'
import crypto from 'crypto'
import { config } from 'dotenv'
config()    // configs the DB env variables

let connectionOptions = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: true }
    : {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    }
export const pool = new Pool(connectionOptions)

export interface ApiResponse<T = undefined> {
    success: boolean,
    data?: T
    error?: string
}

/**
 * Promise Wrapper
 * Wraps an async middleware in a synchronous one, allows eventual promise errors to be caught and passed to the NextFunction error handler
 * @param asyncMiddleware The async function thath will be wrapped for error handling
 */
export const pw: (asyncMiddleware: (req: Request, res: Response, next?: NextFunction) => Promise<any>) => RequestHandler = (asyncMiddleware) => {
    return (req, res, next) => asyncMiddleware(req, res, next).catch(e => next(e))
}

/**
 * Api Wrapper
 * Wrapper for an asynchronous api middleware, which gets wrapped in a promise wrapper
 * @param apiMiddleware Api middleware, asynchronous, returns the ApiResponse that will be sent to the user
 */
export const aw: (apiMiddleware: (req: Request) => Promise<ApiResponse<any>>) => RequestHandler = (apiMiddleware) => {
    return pw(async (req, res) => res.send(await apiMiddleware(req)))
}

/**
 * This async function checks if exists in the database the correct combination of username and password
 * @param username the user's username, as provided in the login form
 * @param password the user's password, as provided in the login form
 */
export async function login(username: string = '', password: string = ''): Promise<boolean> {
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