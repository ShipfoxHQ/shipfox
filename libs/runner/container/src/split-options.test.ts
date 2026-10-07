import {splitOptions} from '#split-options.js';

describe('splitOptions', () => {
  it('splits on whitespace', () => {
    expect(splitOptions('--cpus 4  --memory\t12g\n--privileged')).toEqual([
      '--cpus',
      '4',
      '--memory',
      '12g',
      '--privileged',
    ]);
  });

  it('returns no arguments for an empty string', () => {
    expect(splitOptions('')).toEqual([]);
    expect(splitOptions('   ')).toEqual([]);
  });

  it('keeps quoted text together and removes the quotes', () => {
    expect(splitOptions(`-e 'A=one two' -e "B=three four" --label=""`)).toEqual([
      '-e',
      'A=one two',
      '-e',
      'B=three four',
      '--label=',
    ]);
  });

  it('joins quoted and bare parts of one word', () => {
    expect(splitOptions(`-e A="x y"z`)).toEqual(['-e', 'A=x yz']);
  });

  it('honors backslash escapes', () => {
    expect(splitOptions(String.raw`-e A=x\ y -e "B=say \"hi\" \$HOME \n"`)).toEqual([
      '-e',
      'A=x y',
      '-e',
      String.raw`B=say "hi" $HOME \n`,
    ]);
  });

  it('treats a backslash before a newline as a line continuation', () => {
    expect(splitOptions('--cpus 2 \\\n--memory 4g')).toEqual(['--cpus', '2', '--memory', '4g']);
    expect(splitOptions('-e "A=x\\\ny"')).toEqual(['-e', 'A=xy']);
  });

  it('does not expand variables or commands', () => {
    expect(splitOptions('-e A=$HOME -e B=$(id)')).toEqual(['-e', 'A=$HOME', '-e', 'B=$(id)']);
  });

  it.each([`-e 'A=1`, `-e "A=1`])('rejects an unterminated quote in %s', (options) => {
    expect(() => splitOptions(options)).toThrow('unterminated');
  });
});
