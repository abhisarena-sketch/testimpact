jest.mock('./tax', () => ({ rate: 0 }));
const { total } = require('./cart');

test('mocked tax', () => {
  expect(total([{ price: 100 }])).toBe('$1.00');
});
