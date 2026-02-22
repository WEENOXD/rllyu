import { Hono } from 'hono'
import authRouter from '../routes/auth.js'
import importRouter from '../routes/import.js'
import aiRouter from '../routes/ai.js'
import chatRouter from '../routes/chat.js'
import demoRouter from '../routes/demo.js'

const app = new Hono().basePath('/api')

app.route('/auth', authRouter)
app.route('/import', importRouter)
app.route('/ai', aiRouter)
app.route('/chat', chatRouter)
app.route('/demo', demoRouter)

// Netlify Functions v2 — export default handler + path config
export default async (req: Request) => app.fetch(req)
export const config = { path: '/api/*' }
