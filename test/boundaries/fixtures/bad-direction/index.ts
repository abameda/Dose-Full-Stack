// Deliberately wrong: a direction must never import commerce code.
// test/boundaries/boundaries.test.ts proves the boundary rules reject this file.
import { checkout } from '@dose/core';

export const broken = checkout;
