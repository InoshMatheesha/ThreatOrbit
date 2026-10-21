import type { TestProject } from 'vitest/node';
import { MongoMemoryServer } from 'mongodb-memory-server-core';

let server: MongoMemoryServer | undefined;

/**
 * One throwaway MongoDB for the whole run (each test file uses its own database).
 * The first run downloads a mongod binary; set MONGOMS_SYSTEM_BINARY to use a local one.
 */
export async function setup(project: TestProject) {
  server = await MongoMemoryServer.create();
  project.provide('mongoUri', server.getUri());
}

export async function teardown() {
  await server?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
