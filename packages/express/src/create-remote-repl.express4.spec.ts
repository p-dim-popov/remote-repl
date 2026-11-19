import express from 'express';
import { createRemoteRepl } from './create-remote-repl';
import { describeCreateRemoteRepl } from '../test/create-remote-repl.suite';

// Express 4 leg of the peer range `^4.16 || ^5`: mocking `express` to the
// `express4` alias makes the module under test (and the router it builds)
// resolve Express 4, as in a consumer that installed Express 4.
vi.mock('express', async () => vi.importActual('express4'));

describeCreateRemoteRepl('express 4', express, createRemoteRepl, 4);
