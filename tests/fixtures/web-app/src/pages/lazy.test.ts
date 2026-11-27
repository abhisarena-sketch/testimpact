import { expect, it } from 'vitest';
import { loadForm } from './lazy';

it('loads lazily', async () => expect(await loadForm()).toBeTypeOf('function'));
