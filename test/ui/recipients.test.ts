import { describe, expect, it } from 'vitest';

import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import {
  describeRecipients,
  displayNameFor,
  formatRecipientLabels,
  initialsFor,
  parseAddressList,
  shortNameFor,
} from '../../src/ui/recipients.js';

describe('parseAddressList', () => {
  it('returns nothing for a missing or blank header', () => {
    expect(parseAddressList()).toEqual([]);
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList('   ')).toEqual([]);
  });

  // Regression: THE reason this uses a grammar and not `split(',')`. A comma
  // inside a quoted display name is legal and common, and splitting on it turns
  // two recipients into three — a header that reads `Chen +2 others` on a
  // message with two recipients.
  it('keeps a quoted display name containing a comma in one piece', () => {
    expect(parseAddressList('"Chen, Alice" <alice@acme.example>, bob@acme.example')).toEqual([
      { address: 'alice@acme.example', name: 'Chen, Alice' },
      { address: 'bob@acme.example' },
    ]);
  });

  // Regression: RFC 5322 group syntax (`Team: a@x, b@x;`) nests its mailboxes
  // one level down. Not flattening it drops every recipient in the group.
  it('flattens a group into its mailboxes', () => {
    expect(parseAddressList('Team:alice@acme.example,bob@acme.example;')).toEqual([
      { address: 'alice@acme.example' },
      { address: 'bob@acme.example' },
    ]);
  });

  it('fills in names from the positional list when the header has none', () => {
    expect(parseAddressList('alice@acme.example, bob@acme.example', 'Alice, Bob')).toEqual([
      { address: 'alice@acme.example', name: 'Alice' },
      { address: 'bob@acme.example', name: 'Bob' },
    ]);
  });

  // Regression: the positional column is a fallback, not an override — a store
  // whose name column is stale would otherwise rename the sender of every
  // message that carried a name in the header itself.
  it('prefers the name the header carried', () => {
    expect(parseAddressList('Alice Chen <alice@acme.example>', 'Stale Name')).toEqual([
      { address: 'alice@acme.example', name: 'Alice Chen' },
    ]);
  });

  it('omits the name when neither source has one', () => {
    expect(parseAddressList('alice@acme.example', '  ,  ')).toEqual([
      { address: 'alice@acme.example' },
    ]);
  });

  // Regression: `partial: true` is what keeps one malformed address from taking
  // the whole header down. Showing four of five recipients beats showing none.
  it('keeps the recipients it can parse out of a partly broken header', () => {
    expect(parseAddressList('alice@acme.example, @@broken')).toEqual([
      { address: 'alice@acme.example' },
    ]);
  });

  // Regression: some stores keep bare, unparseable recipient strings. The
  // grammar rejects the whole header, and an empty recipient row would tell the
  // reader the message went to nobody.
  it('falls back to a naive split when the grammar rejects the header outright', () => {
    expect(parseAddressList('not an address, also not one', 'Alice')).toEqual([
      { address: 'not an address', name: 'Alice' },
      { address: 'also not one' },
    ]);
  });

  it('drops empty parts from the fallback split', () => {
    expect(parseAddressList('alice, , bob')).toEqual([{ address: 'alice' }, { address: 'bob' }]);
  });
});

describe('displayNameFor', () => {
  it('prefers the display name', () => {
    expect(displayNameFor('alice@acme.example', '  Alice Chen ')).toBe('Alice Chen');
  });

  // Regression: falling back to the LOCAL PART here would render
  // `noreply@bank.example` as `noreply`, which identifies nobody. Shortening is
  // `shortNameFor`'s job, where the caller asked for it.
  it('falls back to the full address, not the local part', () => {
    expect(displayNameFor('noreply@bank.example')).toBe('noreply@bank.example');
    expect(displayNameFor('noreply@bank.example', '   ')).toBe('noreply@bank.example');
  });

  it('has nothing to say about a sender with neither', () => {
    expect(displayNameFor(null, null)).toBe('');
    expect(displayNameFor(undefined)).toBe('');
  });
});

describe('shortNameFor', () => {
  it('takes the first word of a display name', () => {
    expect(shortNameFor('alice@acme.example', 'Alice Chen')).toBe('Alice');
  });

  it('takes the local part of a bare address', () => {
    expect(shortNameFor('alice.chen@acme.example')).toBe('alice.chen');
  });

  it('returns nothing for a participant with no identity at all', () => {
    expect(shortNameFor('', null)).toBe('');
  });
});

describe('initialsFor', () => {
  it('takes the first and last initial of a name', () => {
    expect(initialsFor('alice@acme.example', 'Alice Chen')).toBe('AC');
    expect(initialsFor('alice@acme.example', 'Alice van der Berg')).toBe('AB');
  });

  it('takes one initial from a single-word name', () => {
    expect(initialsFor('alice@acme.example', 'Alice')).toBe('A');
  });

  // Regression: an address-only sender must still get initials, and the
  // separators mail addresses actually use are dots and underscores, not spaces.
  it('splits an address local part on its separators', () => {
    expect(initialsFor('alice.chen@acme.example')).toBe('AC');
    expect(initialsFor('alice_chen@acme.example')).toBe('AC');
    expect(initialsFor('alice-chen@acme.example')).toBe('AC');
  });

  it('falls back to a placeholder when there is nothing to initial', () => {
    expect(initialsFor(null)).toBe('?');
    expect(initialsFor('___@acme.example')).toBe('?');
  });
});

describe('formatRecipientLabels', () => {
  it('says nothing when there are no recipients', () => {
    expect(formatRecipientLabels([], DEFAULT_LABELS)).toBe('');
  });

  it('lists one or two recipients in full', () => {
    expect(formatRecipientLabels([{ address: 'alice@acme.example' }], DEFAULT_LABELS)).toBe('alice');
    expect(
      formatRecipientLabels(
        [
          { address: 'alice@acme.example', name: 'Alice Chen' },
          { address: 'bob@acme.example', name: 'Bob Ray' },
        ],
        DEFAULT_LABELS,
      ),
    ).toBe('Alice, Bob');
  });

  // Regression: a bubble header that lists nine recipients stops being a chat
  // message. The full list stays one hover away in the tooltip.
  it('counts the overflow instead of listing it', () => {
    const recipients = Array.from({ length: 5 }, (_unused, index) => ({
      address: `p${index}@acme.example`,
      name: `Person ${index}`,
    }));
    expect(formatRecipientLabels(recipients, DEFAULT_LABELS)).toBe('Person, Person +3 others');
  });

  it('honours a different cutoff', () => {
    const recipients = [
      { address: 'a@acme.example', name: 'Alice' },
      { address: 'b@acme.example', name: 'Bob' },
      { address: 'c@acme.example', name: 'Carol' },
    ];
    expect(formatRecipientLabels(recipients, DEFAULT_LABELS, 1)).toBe('Alice +2 others');
    expect(formatRecipientLabels(recipients, DEFAULT_LABELS, 10)).toBe('Alice, Bob, Carol');
  });
});

describe('describeRecipients', () => {
  it('says nothing when there are no recipients', () => {
    expect(describeRecipients([], DEFAULT_LABELS)).toEqual({ names: '', more: '' });
  });

  // Regression: the header truncates the two parts differently, and it can only
  // do that if it gets them apart. Joined into one string the ellipsis lands on
  // the count — `Ankur Dubey +23 othe…` — losing the one number in the header
  // the reader cannot work out by looking at it.
  it('keeps the overflow count out of the truncatable names', () => {
    const recipients = Array.from({ length: 25 }, (_unused, index) => ({
      address: `p${index}@acme.example`,
      name: `Person ${index}`,
    }));
    expect(describeRecipients(recipients, DEFAULT_LABELS)).toEqual({
      names: 'Person, Person',
      more: '+23 others',
    });
  });

  it('reports no overflow when every recipient is named', () => {
    const recipients = [
      { address: 'a@acme.example', name: 'Alice' },
      { address: 'b@acme.example', name: 'Bob' },
    ];
    expect(describeRecipients(recipients, DEFAULT_LABELS)).toEqual({
      names: 'Alice, Bob',
      more: '',
    });
  });

  // Regression: the flat form must stay the two parts with a space between
  // them, or a host that renders `formatRecipientLabels` sees the header drift
  // away from what the bubble shows.
  it('agrees with the flat form it backs', () => {
    const recipients = [
      { address: 'a@acme.example', name: 'Alice' },
      { address: 'b@acme.example', name: 'Bob' },
      { address: 'c@acme.example', name: 'Carol' },
    ];
    const { names, more } = describeRecipients(recipients, DEFAULT_LABELS);
    expect(`${names} ${more}`).toBe(formatRecipientLabels(recipients, DEFAULT_LABELS));
  });
});
