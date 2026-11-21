/** Whether Life Is is keeping everything on this device (the app), rather than talking to a server. */
export const onDevice = () => typeof window !== 'undefined' && Boolean(window.lifeisDevice);
