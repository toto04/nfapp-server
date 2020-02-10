import { Router } from 'express'
import { aw, pool, login } from './util'

let surveys = Router()

surveys.get('/', aw(async (req) => {
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
    return { success: true, data: surveys }
}))

surveys.post('/:survey', aw(async (req) => {
    let client = await pool.connect()
    let username = req.header('x-nfapp-username') || '', password = req.header('x-nfapp-password') || ''
    if (!await login(username, password)) return { success: false, error: 'Credenziali sbagliate' }

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
        return { success: true }
    } catch (e) {
        if (e.message.includes('duplicate')) return { success: false, error: 'Hai già risposto a questo sondaggio' }
        else return { success: false, error: 'Non esiste questo sondaggio' }
    } finally {
        client.release()
    }
}))

export default surveys