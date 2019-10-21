import express from 'express'
const app = express()

app.get('/', (req, res) => {
    res.send('asd')
})
app.listen(2001)