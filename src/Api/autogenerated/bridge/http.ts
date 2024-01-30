import NewHttpClient from './ts/http_client'
const CreateHttpClient = (url: string) => {
    return NewHttpClient({
        baseUrl: url,
        retrieveGuestAuth: async () => { return "" },
        encryptCallback: async () => { throw new Error("encryption not enabled") },
        decryptCallback: async () => { throw new Error("encryption not enabled") },
        deviceId: "",
    })
}
export default CreateHttpClient

export type BridgeHttpClient = ReturnType<typeof CreateHttpClient>
