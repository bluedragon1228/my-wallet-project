import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "../State/store";
import { setLatestOperation, setSourceHistory } from "../State/Slices/HistorySlice";
import { getNostrClient } from "../Api";
import * as Types from '../Api/autogenerated/ts/types'
import { addNotification } from "../State/Slices/notificationSlice";
import { notification } from "antd";
import { NotificationPlacement } from "antd/es/notification/interface";
import { addTransaction } from "../State/Slices/transactionSlice";
import { parseNprofile } from "../Api/nostr";
type Props = {}
export const Background: React.FC<Props> = (): JSX.Element => {

    //reducer
    const nostrSource = useSelector((state) => state.paySource).map((e) => { return { ...e } }).filter((e) => e.pasteField.includes("nprofile"))
    const cursor = useSelector(({ history }) => history.cursor) || {}
    const latestOp = useSelector(({ history }) => history.latestOperation) || {}
    const transaction = useSelector(({ transaction }) => transaction) || {}
    const dispatch = useDispatch();
    const [initialFetch, setInitialFetch] = useState(true)
    const [api, contextHolder] = notification.useNotification();
    const openNotification = (placement: NotificationPlacement, header: string, text: string) => {
        api.info({
            message: header,
            description:
                text,
            placement
        });
    };

    useEffect(() => {
        const subbed: string[] = []
        nostrSource.forEach(source => {
            if (subbed.find(s => s === source.pasteField)) {
                return
            }
            subbed.push(source.pasteField)
            getNostrClient(source.pasteField).then(c => {
                c.GetLiveUserOperations(newOp => {
                    if (newOp.status === "OK") {
                        console.log(newOp)
                        dispatch(addNotification({
                            header: 'Payments',
                            icon: '⚡',
                            desc: `You received ` + newOp.operation.amount + ` payments.`,
                            date: Date.now(),
                            link: '/home',
                        }))
                        openNotification("top", "Payments", "You received payment.");
                        dispatch(addTransaction({
                            amount: newOp.operation.amount + '',
                            memo: "",
                            time: Date.now(),
                            destination: newOp.operation.identifier,
                            inbound: true,
                            confirm: {},
                            invoice: "",
                        }))
                        dispatch(setLatestOperation({ operation: newOp.operation }))
                    } else {
                        console.log(newOp.reason)
                    }
                })
            })
        })
    }, [])

    useEffect(() => {
        if (Object.entries(latestOp).length === 0 && !initialFetch) {
            return
        }
        console.log({ latestOp, initialFetch })
        setInitialFetch(false)
        const sent: string[] = []
        nostrSource.forEach(source => {
            const { pubkey, relays } = parseNprofile(source.pasteField)
            if (sent.find(s => s === pubkey)) {
                return
            }
            sent.push(pubkey)
            getNostrClient({ pubkey, relays }).then(c => {
                const req = populateCursorRequest(cursor)
                c.GetUserOperations(req).then(ops => {
                    if (ops.status === 'OK') {
                        console.log((ops), "ops")
                        dispatch(setSourceHistory({ pub: pubkey, ...parseOperationsResponse(ops) }))
                    } else {
                        console.log(ops.reason, "ops.reason")
                    }
                })
            })
        })
    }, [latestOp, initialFetch, transaction])
    return <>
        {contextHolder}
    </>
}

const populateCursorRequest = (p: Partial<Types.GetUserOperationsRequest>): Types.GetUserOperationsRequest => {
    return {
        // latestIncomingInvoice: p.latestIncomingInvoice || 0,
        // latestOutgoingInvoice: p.latestOutgoingInvoice || 0,
        // latestIncomingTx: p.latestIncomingTx || 0,
        // latestOutgoingTx: p.latestOutgoingTx || 0,
        // latestIncomingUserToUserPayment: p.latestIncomingUserToUserPayment || 0,
        // latestOutgoingUserToUserPayment: p.latestOutgoingUserToUserPayment || 0,

        latestIncomingInvoice: 0,
        latestOutgoingInvoice: 0,
        latestIncomingTx: 0,
        latestOutgoingTx: 0,
        latestIncomingUserToUserPayment: 0,
        latestOutgoingUserToUserPayment: 0,
    }
}

const parseOperationsResponse = (r: Types.GetUserOperationsResponse): { cursor: Types.GetUserOperationsRequest, operations: Types.UserOperation[] } => {
    const cursor = {
        latestIncomingInvoice: r.latestIncomingInvoiceOperations.toIndex,
        latestOutgoingInvoice: r.latestOutgoingInvoiceOperations.toIndex,
        latestIncomingTx: r.latestIncomingTxOperations.toIndex,
        latestOutgoingTx: r.latestOutgoingTxOperations.toIndex,
        latestIncomingUserToUserPayment: r.latestIncomingUserToUserPayemnts.toIndex,
        latestOutgoingUserToUserPayment: r.latestOutgoingUserToUserPayemnts.toIndex,
    }
    const operations = [
        ...r.latestIncomingInvoiceOperations.operations,
        ...r.latestOutgoingInvoiceOperations.operations,
        ...r.latestIncomingTxOperations.operations,
        ...r.latestOutgoingTxOperations.operations,
        ...r.latestIncomingUserToUserPayemnts.operations,
        ...r.latestOutgoingUserToUserPayemnts.operations,
    ]
    console.log({ operations })
    return { cursor, operations }
}
