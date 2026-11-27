const { formatMoney } = require('../lib/util/money');

test('formats', () => expect(formatMoney(150)).toBe('$1.50'));
