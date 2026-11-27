// Generates docs/testimpact.schema.json from the Zod configuration schema (run after `npm run build`).
import fs from 'node:fs';
import { z } from 'zod';
import { ConfigSchema } from '@testimpact/core';

const schema = z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' });
schema.$id = 'https://raw.githubusercontent.com/abhisarena-sketch/testimpact/main/docs/testimpact.schema.json';
schema.title = 'TestImpact configuration';
fs.writeFileSync(new URL('../docs/testimpact.schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
console.log('wrote docs/testimpact.schema.json');
