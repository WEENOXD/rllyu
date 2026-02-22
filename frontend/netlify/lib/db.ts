import { PrismaClient } from '@prisma/client'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'

// Reuse across warm invocations within the same Lambda instance
let _prisma: PrismaClient | undefined

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const adapter = new PrismaNeonHTTP(process.env.DATABASE_URL!, {})
    _prisma = new PrismaClient({ adapter })
  }
  return _prisma
}

export default { get client() { return getPrisma() } }
