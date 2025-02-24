import express, { Application } from 'express';
import { ErrorSerializer } from 'ts-japi';

import Vault from './Vault';
import sendTransaction from './tools/sendTransaction';
import generateAddress from './tools/generateAddress';
import {
  BugsnagPluginExpressResult,
  DbAddressType,
  TransactionsReqBody,
} from './types';
import Db from './Db';

const PrimitiveErrorSerializer = new ErrorSerializer();

export default class HttpServer {
  app: Application;
  port: number;
  vault: Vault;
  db: Db;
  bugsnag?: BugsnagPluginExpressResult;

  constructor({
    port,
    vault,
    db,
    bugsnag,
  }: {
    port: number;
    vault: Vault;
    db: Db;
    bugsnag?: BugsnagPluginExpressResult;
  }) {
    this.port = port;
    this.vault = vault;
    this.db = db;
    this.bugsnag = bugsnag;

    this.app = express();

    if (this.bugsnag) {
      this.app.use(this.bugsnag.requestHandler);
    }

    this.app.use(express.json());

    this.app.get('/', (req, res) => {
      res.json({ service: 'ridvan' });
      return;
    });

    this.app.post('/transactions', async (req, res) => {
      try {
        const body: TransactionsReqBody = req.body;

        const address = await this.db.getAddress({
          address: body.params.from as string,
          network_key: body.network_key,
        });

        if (!address) {
          res.status(400).json({
            errors: [
              { title: 'address not found', detail: `address not found` },
            ],
            jsonapi: { version: '1.0' },
          });
          return;
        }

        const node = await this.db.getNode({
          network_key: body.network_key,
          node_id: body.node_id,
        });

        if (!node) {
          res.status(400).json({
            errors: [{ title: 'node not found', detail: 'node not found' }],
            jsonapi: { version: '1.0' },
          });
          return;
        }

        const pk = await this.vault.decrypt({
          ciphertext: address.key_encrypted,
        });

        if (!pk) {
          res.status(500).json({ message: 'vault decrypt error' });
          return;
        }

        const response = await sendTransaction({
          params: body.params,
          pk,
          nodeUrl: node.url,
        });

        if (response.status !== 'OK') {
          res.status(500).json({
            errors: response.errors,
            jsonapi: { version: '1.0' },
          });
          return;
        }

        res.status(200).json({
          data: { type: 'transactions', attributes: response.data },
          jsonapi: { version: '1.0' },
        });
        return;
      } catch (error) {
        const errorDocument = PrimitiveErrorSerializer.serialize(error);
        res.status(500).json(errorDocument);
      }
    });

    this.app.post('/addresses', async (req, res) => {
      try {
        const address: DbAddressType = req.body;

        const response = await this.db.addAddress(address);

        res.status(200).json({
          data: { type: 'addresses', attributes: response },
          jsonapi: { version: '1.0' },
        });
        return;
      } catch (error) {
        const errorDocument = PrimitiveErrorSerializer.serialize(error);
        res.status(500).json(errorDocument);
      }
    });

    this.app.post('/addresses/generate', async (req, res) => {
      try {
        const {
          network_key,
          owner_kind,
        }: { network_key: string; owner_kind: 'user' | 'system' } = req.body;

        if (!['user', 'system'].includes(owner_kind)) {
          res.status(400).json({
            errors: [
              { title: 'owner_kind not valid', detail: 'owner_kind not valid' },
            ],
            jsonapi: { version: '1.0' },
          });
          return;
        }

        const node = await this.db.getNode({
          network_key: network_key,
        });

        if (!node) {
          res.status(400).json({
            errors: [{ title: 'node not found', detail: 'node not found' }],
            jsonapi: { version: '1.0' },
          });
          return;
        }

        const { address, privateKey } = generateAddress();

        const key_encrypted = await vault.encrypt({
          plaintext: privateKey,
        });

        if (!key_encrypted) {
          throw new Error('vault encrypt error');
        }

        const response = await this.db.addAddress({
          address,
          key_encrypted,
          created_at: new Date().toISOString(),
          network_key,
          owner_kind,
        });

        res.status(200).json({
          data: { type: 'addresses', attributes: response },
          jsonapi: { version: '1.0' },
        });
        return;
      } catch (error) {
        const errorDocument = PrimitiveErrorSerializer.serialize(error);
        res.status(500).json(errorDocument);
      }
    });

    if (this.bugsnag) {
      this.app.use(this.bugsnag.errorHandler);
    }
  }

  async start(): Promise<void> {
    this.app.listen(this.port, '0.0.0.0');
    console.log(`http server started on ${this.port}`);
  }
}
