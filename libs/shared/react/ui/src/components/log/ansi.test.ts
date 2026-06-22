import {parseAnsi} from './ansi.js';

const ESC = String.fromCharCode(27);

describe('parseAnsi', () => {
  test('returns a single unstyled span for plain text', () => {
    const result = parseAnsi('hello world');

    expect(result).toEqual([{text: 'hello world', className: '', start: 0}]);
  });

  test('maps a foreground color to a palette class', () => {
    const result = parseAnsi(`${ESC}[31mred${ESC}[0m`);

    expect(result).toEqual([{text: 'red', className: 'text-red-400', start: 5}]);
  });

  test('maps a background color to a palette class', () => {
    const result = parseAnsi(`${ESC}[42mok`);

    expect(result).toEqual([{text: 'ok', className: 'bg-green-500', start: 5}]);
  });

  test('combines a color with a bold attribute', () => {
    const result = parseAnsi(`${ESC}[1;32mok`);

    expect(result).toEqual([{text: 'ok', className: 'text-green-400 font-bold', start: 7}]);
  });

  test('reset clears all styling for the following text', () => {
    const result = parseAnsi(`${ESC}[31mA${ESC}[0mB`);

    expect(result).toEqual([
      {text: 'A', className: 'text-red-400', start: 5},
      {text: 'B', className: '', start: 10},
    ]);
  });

  test('an empty parameter list is shorthand for reset', () => {
    const result = parseAnsi(`${ESC}[31mA${ESC}[mB`);

    expect(result.map((span) => [span.text, span.className])).toEqual([
      ['A', 'text-red-400'],
      ['B', ''],
    ]);
  });

  test('default-foreground (39) clears the color but keeps other attributes', () => {
    const result = parseAnsi(`${ESC}[1;31mA${ESC}[39mB`);

    expect(result.map((span) => [span.text, span.className])).toEqual([
      ['A', 'text-red-400 font-bold'],
      ['B', 'font-bold'],
    ]);
  });

  test('22 clears bold and dim without touching color', () => {
    const result = parseAnsi(`${ESC}[1;2;34mA${ESC}[22mB`);

    expect(result.map((span) => [span.text, span.className])).toEqual([
      ['A', 'text-blue-400 font-bold opacity-60'],
      ['B', 'text-blue-400'],
    ]);
  });

  test('consumes 256-color operands without leaking them as text', () => {
    const result = parseAnsi(`${ESC}[38;5;200mX`);

    expect(result).toEqual([{text: 'X', className: '', start: 11}]);
  });

  test('consumes truecolor operands without leaking them as text', () => {
    const result = parseAnsi(`${ESC}[38;2;255;0;0mX`);

    expect(result).toEqual([{text: 'X', className: '', start: 15}]);
  });

  test('renders italic and underline together', () => {
    const result = parseAnsi(`${ESC}[3;4mX`);

    expect(result[0]?.className).toBe('italic underline');
  });

  test('leaves a non-SGR escape sequence untouched as text', () => {
    const result = parseAnsi(`${ESC}[2Kdone`);

    expect(result).toEqual([{text: `${ESC}[2Kdone`, className: '', start: 0}]);
  });
});
