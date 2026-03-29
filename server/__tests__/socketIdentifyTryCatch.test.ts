import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('socket:identify try/catch (#46)', () => {
  const handlersSource = fs.readFileSync(
    path.resolve(__dirname, '../socket/handlers.ts'), 'utf-8'
  );

  it('wraps socket:identify DB queries in try/catch', () => {
    const identifyIdx = handlersSource.indexOf("'socket:identify'");
    const identifyBlock = handlersSource.slice(identifyIdx, identifyIdx + 5000);
    expect(identifyBlock).toMatch(/try\s*\{/);
    expect(identifyBlock).toMatch(/catch/);
  });

  it('disconnects socket on identify error', () => {
    const identifyIdx = handlersSource.indexOf("'socket:identify'");
    const identifyBlock = handlersSource.slice(identifyIdx, identifyIdx + 5000);
    expect(identifyBlock).toMatch(/catch[\s\S]*?disconnect/);
  });
});
