import { pipe } from 'it-pipe'
import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, Identities, KeyStore } from '@orbitdb/core'
import { LevelBlockstore } from 'blockstore-level'
import { LevelDatastore } from 'datastore-level'
import { join } from 'path'
import libp2pConfig from './libp2p/index.js'
import Authorization, { Access } from './authorization.js'
import { processMessage } from './messages/index.js'

const directory = join('./', 'pinner')
const path = join(directory, '/', 'keystore')

export default async ({ defaultAccess } = {}) => {
  const protocol = '/orbitdb/pinner/v1.0.0'

  defaultAccess = defaultAccess || Access.DENY

  const blockstore = new LevelBlockstore(join(directory, '/', 'ipfs', '/', 'blocks'))
  const datastore = new LevelDatastore(join(directory, '/', 'ipfs', '/', 'data'))
  const libp2p = await createLibp2p(libp2pConfig)
  const ipfs = await createHelia({ libp2p, datastore, blockstore })

  const keystore = await KeyStore({ path })
  const identities = await Identities({ keystore })
  const id = 'pinner'

  const orbitdb = await createOrbitDB({ ipfs, directory, identities, id })

  const pins = await orbitdb.open('pins', { type: 'keyvalue' })

  const auth = await Authorization({ orbitdb, defaultAccess })

  const dbs = []

  const handleMessage = async ({ stream }) => {
    await pipe(stream, processMessage({ orbitdb, pins, dbs, auth }), stream)
  }

  await orbitdb.ipfs.libp2p.handle(protocol, handleMessage)

  for await (const db of pins.iterator()) {
    dbs[db.value] = await orbitdb.open(db.value)
    console.log('db opened', db.value)
  }
  console.log('dbs loaded')

  const stop = async () => {
    await orbitdb.ipfs.libp2p.unhandle(protocol)
    await orbitdb.stop()
    await ipfs.stop()
    await blockstore.close()
    await datastore.close()
  }

  return {
    pins,
    dbs,
    orbitdb,
    ipfs,
    auth,
    stop
  }
}
