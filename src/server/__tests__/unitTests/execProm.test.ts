import { exec2JSON } from '../../lib/execProm';

test('preserves non-JSON CLI stderr instead of throwing a JSON parsing error', async () => {
    await expect(exec2JSON('node -e "process.stderr.write(\'CLI startup failed\'); process.exit(1)"'))
        .rejects.toThrow('CLI startup failed');
});

test('preserves structured CLI failures for the caller', async () => {
    const result = await exec2JSON('node -e "console.log(JSON.stringify({status:1,message:\'Creation failed\'}));process.exit(1)"');
    expect(result).toEqual({ status: 1, message: 'Creation failed' });
});

test('rejects empty successful output explicitly', async () => {
    await expect(exec2JSON('node -e "process.exit(0)"')).rejects.toThrow('without valid JSON output');
});

test('does not accept a reported success when the process exits unsuccessfully', async () => {
    await expect(exec2JSON('node -e "console.log(JSON.stringify({status:0}));process.stderr.write(\'Failed after output\');process.exit(1)"'))
        .rejects.toThrow('Failed after output');
});
