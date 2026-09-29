import { describe, expect, it } from 'vitest';
import { compare } from './dedupe.js';

describe('deciding whether two headlines are one story', () => {
  it('calls five outlets on one announcement the same story', () => {
    expect(
      compare(
        'Samsung expected to more than double HBM4 and HBM4E output',
        'Samsung to more than double HBM4 and HBM4E production next year',
      ).verdict,
    ).toBe('same');
  });

  it('keeps unrelated stories apart', () => {
    expect(
      compare('NASA cannot move the space station robotic arm', 'Dutch police arrest a hacker')
        .verdict,
    ).toBe('different');
  });

  /*
   * The case that put one launch on the page twice: the vendor's own short
   * headline and a newspaper's long one. Trigram similarity is far too low, so
   * before this the pair never even reached the model.
   */
  it('asks the model about a vendor headline contained in a news one', () => {
    const { verdict } = compare(
      'Claude Sonnet 5.5',
      'Anthropic releases Sonnet 5.5, which it calls a significantly cheaper, faster work partner',
    );
    expect(verdict).toBe('unsure');
  });

  it('does not ask about two stories that merely share one name', () => {
    expect(compare('Nvidia earnings beat expectations', 'Nvidia opens a Munich office').verdict).toBe(
      'different',
    );
  });
});
