// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { sendGarminCourse, installGarminDialog } from './garmin';
import { mountUI } from './layout';
import { gpxFilename } from '../gpx';

const input = { name: '花脊/試走', profile: 'mtb' as const, resolvedTrack: [{ lat: 35, lng: 135, ele: 123.4 }, { lat: 35.01, lng: 135.01, ele: 145 }] };
const share = vi.fn(), canShare = vi.fn(), show = vi.fn();
let downloaded: string;
beforeEach(() => {
  localStorage.clear(); document.body.innerHTML = '<div id="app"></div>'; mountUI();
  share.mockReset().mockResolvedValue(undefined); canShare.mockReset().mockReturnValue(false); show.mockReset();
  vi.stubGlobal('navigator', { share, canShare });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:fit');
    static revokeObjectURL = vi.fn();
  });
  downloaded = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('shares a valid FIT File after loading the encoder, with its title and the GPX filename rule', async () => {
  canShare.mockReturnValue(true);
  const sending = sendGarminCourse(input, show);
  expect(share).not.toHaveBeenCalled();
  await sending;
  expect(share).toHaveBeenCalledOnce();
  const data = share.mock.calls[0][0], file = data.files[0] as File;
  expect(data.title).toBe(input.name);
  expect(file.name).toBe(gpxFilename(input.name).replace(/\.gpx$/, '.fit'));
  expect(file.type).toBe('application/octet-stream');
  expect(canShare).toHaveBeenCalledWith({ files: [file] });
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(file);
  });
  const decoder = new Decoder(Stream.fromByteArray(new Uint8Array(bytes)));
  expect(decoder.isFIT()).toBe(true); expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]); expect(messages.fileIdMesgs![0].type).toBe('course');
  expect(messages.fileIdMesgs![0].serialNumber).toBeGreaterThan(0);
  expect(messages.recordMesgs).toHaveLength(2); expect(messages.recordMesgs![0].altitude).toBeCloseTo(123.4);
  expect(show).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it.each([false, undefined])('downloads and shows instructions when canShare is %s', async capability => {
  vi.useFakeTimers(); if (capability === undefined) vi.stubGlobal('navigator', {});
  await sendGarminCourse(input, show);
  expect(downloaded).toBe(gpxFilename(input.name).replace(/\.gpx$/, '.fit'));
  expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(show).toHaveBeenCalledOnce(); expect(share).not.toHaveBeenCalled();
  expect(document.querySelector('a[download]')).toBeNull();
  await vi.advanceTimersByTimeAsync(1000); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fit');
});
it('silently handles cancellation without downloading or opening instructions', async () => {
  canShare.mockReturnValue(true); share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));
  await expect(sendGarminCourse(input, show)).resolves.toBeUndefined();
  expect(show).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('propagates share errors for the UI to report without an unexpected download', async () => {
  canShare.mockReturnValue(true); share.mockRejectedValue(new Error('share failed'));
  await expect(sendGarminCourse(input, show)).rejects.toThrow('share failed');
  expect(show).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('opens a labelled native dialog, closes it, and restores the saved suppression choice', () => {
  const dialog = document.getElementById('garmin-dialog') as HTMLDialogElement;
  dialog.showModal = vi.fn(() => { dialog.open = true; }); dialog.close = vi.fn(() => { dialog.open = false; });
  const trigger = document.getElementById('garmin')!;
  const open = installGarminDialog(); open(trigger);
  expect(dialog.open).toBe(true); expect(dialog.getAttribute('aria-labelledby')).toBe('garmin-title');
  document.getElementById('garmin-hide-instructions')!.click();
  document.getElementById('garmin-close')!.click(); expect(dialog.open).toBe(false);
  dialog.dispatchEvent(new Event('close')); expect(document.activeElement).toBe(trigger);
  installGarminDialog()(); expect(dialog.showModal).toHaveBeenCalledOnce();
});
it('keeps downloading instructions usable when localStorage is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const dialog = document.getElementById('garmin-dialog') as HTMLDialogElement; dialog.showModal = vi.fn();
  const open = installGarminDialog(); open(); expect(dialog.showModal).toHaveBeenCalledOnce();
  document.getElementById('garmin-hide-instructions')!.click(); open(); expect(dialog.showModal).toHaveBeenCalledOnce();
});
