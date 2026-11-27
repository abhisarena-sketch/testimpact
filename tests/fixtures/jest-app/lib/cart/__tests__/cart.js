const { total } = require('../cart');

test('total', () => {
  expect(total([{ price: 100 }])).toBe('$1.20');
});
