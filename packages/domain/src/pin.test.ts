import { describe, expect, it } from 'vitest';
import { isCommonPin } from './pin.js';

describe('isCommonPin', () => {
  it('refuses one digit over and over, at any length', () => {
    for (const pin of ['0000', '1111', '99999', '777777', '00000000']) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('refuses runs up and down, at any length', () => {
    for (const pin of [
      '1234',
      '4321',
      '0123',
      '9876',
      '2345',
      '6789',
      '7890',
      '0987',
      '34567',
      '123456',
      '654321',
      '12345678',
      '87654321',
    ]) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('refuses a short block repeated', () => {
    for (const pin of ['1212', '1313', '6969', '4545', '121212', '123123', '12341234']) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('refuses each digit doubled', () => {
    for (const pin of ['1122', '5588', '112233', '11223344']) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('refuses straight lines on the keypad, with or without the 0 below', () => {
    for (const pin of [
      '2580',
      '0852',
      '1470',
      '7410',
      '3690',
      '9630',
      '1590',
      '7530',
      '0147',
      '0369',
      '147258',
      '159753',
      '789456',
      '147852',
    ]) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('refuses the most guessed', () => {
    for (const pin of ['1004', '2000', '2001', '1010', '1122', '1313', '0007', '2468', '5683']) {
      expect(isCommonPin(pin), pin).toBe(true);
    }
  });

  it('lets an ordinary PIN through', () => {
    for (const pin of ['4821', '7395', '0583', '482193', '9172', '30571846', '2741', '1593']) {
      expect(isCommonPin(pin), pin).toBe(false);
    }
  });
});
