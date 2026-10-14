import { SingleFlight } from './single-flight';

describe('SingleFlight', () => {
  it('shares one promise between concurrent callers and clears it afterwards', async () => {
    const sf = new SingleFlight();
    const fn = jest.fn(async () => 42);
    const results = await Promise.all([
      sf.run('k', fn),
      sf.run('k', fn),
      sf.run('k', fn),
    ]);
    expect(results).toEqual([42, 42, 42]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sf.size).toBe(0);
    await sf.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the key when the call fails', async () => {
    const sf = new SingleFlight();
    await expect(
      sf.run('k', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(sf.size).toBe(0);
  });
});
