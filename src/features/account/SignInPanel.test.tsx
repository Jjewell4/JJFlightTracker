import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInPanel } from './SignInPanel';
const api = vi.hoisted(() => ({ signInPassword: vi.fn(), createPasswordAccount: vi.fn(), requestPasswordReset: vi.fn() }));
vi.mock('@/services/sync/supabase', () => api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
async function mount(){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<SignInPanel/>));}
async function fill(selector:string,value:string){const input=host.querySelector<HTMLInputElement>(selector)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});}
describe('password sign-in UI',()=>{
 it('submits credentials and clears the password on success',async()=>{api.signInPassword.mockResolvedValue(undefined);await mount();await fill('input[type=email]','person@example.com');await fill('input[type=password]','safe-password');await submit();expect(api.signInPassword).toHaveBeenCalledWith('person@example.com','safe-password');expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');});
 it('offers recovery to previous email-link users without requesting sign-in OTP',async()=>{api.requestPasswordReset.mockResolvedValue(undefined);await mount();await fill('input[type=email]','person@example.com');await act(async()=>{Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Forgot password'))!.click();});expect(host.querySelector('input[type=password]')).toBeNull();await submit();expect(api.requestPasswordReset).toHaveBeenCalledWith('person@example.com');expect(host.querySelector('[role=status]')?.textContent).toContain('If an account exists');expect(api.signInPassword).not.toHaveBeenCalled();});
});
