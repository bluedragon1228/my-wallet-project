import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "../State/store";
import { setLatestOperation, setSourceHistory } from "../State/Slices/HistorySlice";
import { addAsset } from '../State/Slices/generatedAssets';
import { getNostrClient } from "../Api";
import * as Types from '../Api/autogenerated/ts/types'
import { addNotification } from "../State/Slices/notificationSlice";
import { NODED_UP_STORAGE_KEY, decodeLnurl, getFormattedTime } from "../constants";
import { useIonRouter } from "@ionic/react";
import { Modal } from "./Modals/Modal";
import { UseModal } from "../Hooks/UseModal";
import * as icons from '../Assets/SvgIconLibrary';
import { Clipboard } from '@capacitor/clipboard';
import { validate } from 'bitcoin-address-validation';
import { Client as NostrClient, parseNprofile } from "../Api/nostr";
import { editSpendSources } from "../State/Slices/spendSourcesSlice";
import axios, { isAxiosError } from "axios";
import { openNotification } from "../constants";
import { SubscriptionsBackground } from "./BackgroundJobs/subscriptions";
import { HealthCheck } from "./BackgroundJobs/HealthCheck";
import { LnAddressCheck } from "./BackgroundJobs/LnAddressCheck";
import { SpendFrom } from "../globalTypes";
import { NewSourceCheck } from "./BackgroundJobs/NewSourceCheck";
import { NodeUpCheck } from "./BackgroundJobs/NodeUpCheck";

export const Background = () => {

	const router = useIonRouter();
	//reducer
	const savedAssets = useSelector(state => state.generatedAssets.assets)
	const spendSource = useSelector((state) => state.spendSource)
	const nostrSource = useSelector((state) => Object.values(state.spendSource.sources).filter((e) => e.pubSource));
	const paySource = useSelector((state) => state.paySource)
	const cursor = useSelector(({ history }) => history.cursor) || {}
	const latestOp = useSelector(({ history }) => history.latestOperation) || {}
	const dispatch = useDispatch();
	const [initialFetch, setInitialFetch] = useState(true)
	const [clipText, setClipText] = useState("")
	const { isShown, toggle } = UseModal();
	const isShownRef = useRef(false);

	useEffect(() => {
		isShownRef.current = isShown;
	}, [isShown])


	window.onbeforeunload = function () { return null; };

	useEffect(() => {
		const handleBeforeUnload = () => {
			// Call your function here
			localStorage.setItem("lastOnline", Date.now().toString())
			localStorage.setItem("getHistory", "false");
			return false;
		};

		window.addEventListener('beforeunload', handleBeforeUnload);

		return () => {
			return window.removeEventListener('beforeunload', handleBeforeUnload);
		}
	}, []);

	useEffect(() => {
		nostrSource.forEach(source => {
			const { pubkey, relays } = parseNprofile(source.pasteField)

			getNostrClient({ pubkey, relays }).then(c => {
				c.GetLiveUserOperations(newOp => {
					if (newOp.status === "OK") {
						openNotification("top", "Payments", "You received payment.");
						dispatch(setLatestOperation({ pub: pubkey, operation: newOp.operation }))
					} else {
						console.log(newOp.reason)
					}
				})
			})
		});
	}, [nostrSource, dispatch])

	useEffect(() => {
		const nostrSpends = Object.values(spendSource.sources).filter((e) => e.pubSource);
		const otherPaySources = Object.values(paySource.sources).filter((e) => !e.pubSource);
		const otherSpendSources = Object.values(spendSource.sources).filter((e) => !e.pubSource);

		if ((nostrSpends.length !== 0 && nostrSpends[0].balance !== "0") || (otherPaySources.length > 0 || otherSpendSources.length > 0)) {
			if (localStorage.getItem("isBackUp") == "1") {
				return;
			}
			dispatch(addNotification({
				header: 'Reminder',
				icon: '⚠️',
				desc: 'Back up your credentials!',
				date: Date.now(),
				link: '/auth',
			}))
			localStorage.setItem("isBackUp", "1")
			openNotification("top", "Reminder", "Please back up your credentials!", () => { router.push("/auth") });
		}
	}, [paySource, spendSource, dispatch, router])

	const getSourceInfo = async (source: SpendFrom, client: NostrClient) => {
		const res = await client.GetUserInfo()
		if (res.status === 'ERROR') {
			console.log(res.reason)
			return
		}
		dispatch(editSpendSources({
			...source,
			balance: `${res.balance}`,
			maxWithdrawable: `${res.max_withdrawable}`
		}))
	}
	const fetchSourceHistory = async (source: SpendFrom, client: NostrClient, pubkey: string, newCurosor?: Partial<Types.GetUserOperationsRequest>, newData?: Types.UserOperation[]) => {
		const req = populateCursorRequest(newCurosor || cursor)
		const res = await client.GetUserOperations(req)
		if (res.status === 'ERROR') {
			console.log(res.reason)
			return
		}
		console.log((res), "ops")
		const totalHistory = parseOperationsResponse(res);
		const totalData = (newData || []).concat(totalHistory.operations)
		if (totalHistory.needMoreData) {
			console.log("need more operations from server, fetching...")
			fetchSourceHistory(source, client, pubkey, totalHistory.cursor, totalHistory.operations)
			return
		}

		const lastTimestamp = parseInt(localStorage.getItem('lastOnline') ?? "0")
		const payments = totalData.filter((e) => e.inbound && e.paidAtUnix * 1000 > lastTimestamp)
		if (payments.length > 0) {
			if (localStorage.getItem("getHistory") === "true") return;
			dispatch(addNotification({
				header: 'Payments',
				icon: '⚡',
				desc: 'You received ' + payments.length + ' payments since you have been away.',
				date: Date.now(),
				link: '/home',
			}))
			localStorage.setItem("getHistory", "true");
		}
		dispatch(setSourceHistory({ pub: pubkey, ...totalHistory }));
	}

	useEffect(() => {
		if (Object.entries(latestOp).length === 0 && !initialFetch) {
			return
		}

		setInitialFetch(false)

		nostrSource.forEach(async s => {
			const { pubkey, relays } = parseNprofile(s.pasteField)
			const client = await getNostrClient({ pubkey, relays })
			await getSourceInfo(s, client)
			await fetchSourceHistory(s, client, pubkey)
		})
	}, [latestOp, initialFetch])

	



	// reset spend for lnurl
	useEffect(() => {
		const sources = Object.values(spendSource.sources).map(s => ({ ...s }));
		sources.filter(s => !s.disabled).forEach(async source => {
			if (!source.pasteField.startsWith("nprofile")) {
				try {
					const lnurlEndpoint = decodeLnurl(source.pasteField);
					const response = await axios.get(lnurlEndpoint);
					source.balance = Math.round(response.data.maxWithdrawable / 1000).toString();
					dispatch(editSpendSources(source));
				} catch (err) {
					if (isAxiosError(err) && err.response) {
						dispatch(addNotification({
							header: 'Spend Source Error',
							icon: '⚠️',
							desc: `Spend source ${source.label} is saying: ${err.response.data.reason}`,
							date: Date.now(),
							link: `/sources?sourceId=${source.id}`,
						}))
						// update the erroring source
						source.disabled = err.response.data.reason;
						dispatch(editSpendSources(source));
					} else if (err instanceof Error) {
						openNotification("top", "Error", err.message);
					} else {
						console.log("Unknown error occured", err);
					}
				}
			}
		})
	}, [router, dispatch])

	const checkClipboard = useCallback(async () => {
		window.onbeforeunload = null;
		let text = '';
		document.getElementById('focus_div')?.focus();
		if (document.hidden) {
			window.focus();
		}
		if (isShownRef.current) {
			return;
		}
		try {
			const { type, value } = await Clipboard.read();
			if (type === "text/plain") {
				text = value;
			}
		} catch (error) {
			return console.error('Error reading clipboard data:', error);
		}
		if (savedAssets?.includes(text)) {
			return;
		}
		if (!text.length) {
			return
		}
		
		const expression: RegExp = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
		const boolLnAddress = expression.test(text);
		let boolLnInvoice = false;
		if (text.startsWith("ln") && nostrSource.length > 0) {

			const result = await (await getNostrClient(nostrSource[0].pasteField)).DecodeInvoice({ invoice: text });
			boolLnInvoice = result.status == "OK";
		}
		const boolAddress = validate(text);
		const boolLnurl = text.startsWith("lnurl");

		if (boolAddress || boolLnInvoice || boolLnAddress || boolLnurl) {
			setClipText(text);
			toggle();
		}
	}, [savedAssets]);

	useEffect(() => {
		window.addEventListener("visibilitychange", checkClipboard);
		window.addEventListener("focus", checkClipboard);

		return () => {
			window.removeEventListener("visibilitychange", checkClipboard);
			window.removeEventListener("focus", checkClipboard);
		};
	}, [checkClipboard])

	useEffect(() => {
		checkClipboard();
	}, [checkClipboard])

	useEffect(() => {
		const nodedUp = localStorage.getItem(NODED_UP_STORAGE_KEY);
		const routes = ["/", "/sources", "/auth"];
		if (!nodedUp && !routes.includes(router.routeInfo.pathname)) {
			router.push("/");
		}
	}, [router.routeInfo.pathname])


	const clipBoardContent = <React.Fragment>
		<div className='Home_modal_header'>Clipboard Detected</div>
		<div className='Home_modal_discription'>Would you like to use it?</div>
		<div className='Home_modal_clipboard'>{clipText}</div>
		<div className="Home_add_btn">
			<div className='Home_add_btn_container'>
				<button onClick={() => { toggle(); dispatch(addAsset({ asset: clipText }));}}>
					{icons.Close()}NO
				</button>
			</div>
			<div className='Home_add_btn_container'>
				<button onClick={() => { toggle(); router.push("/send?url=" + clipText); dispatch(addAsset({ asset: clipText }));}}>
					{icons.clipboard()}YES
				</button>
			</div>
		</div>
	</React.Fragment>;

	return <div id="focus_div">
		<SubscriptionsBackground />
		<HealthCheck />
		<NewSourceCheck />
		<LnAddressCheck />
		<NodeUpCheck />
		<Modal isShown={isShown} hide={() => { toggle()}} modalContent={clipBoardContent} headerText={''} />
	</div>
}

const populateCursorRequest = (p: Partial<Types.GetUserOperationsRequest>): Types.GetUserOperationsRequest => {
	console.log(p)
	return {
		latestIncomingInvoice: p.latestIncomingInvoice || 0,
		latestOutgoingInvoice: p.latestOutgoingInvoice || 0,
		latestIncomingTx: p.latestIncomingTx || 0,
		latestOutgoingTx: p.latestOutgoingTx || 0,
		latestIncomingUserToUserPayment: p.latestIncomingUserToUserPayment || 0,
		latestOutgoingUserToUserPayment: p.latestOutgoingUserToUserPayment || 0,

		// latestIncomingInvoice: 0,
		// latestOutgoingInvoice: 0,
		// latestIncomingTx: 0,
		// latestOutgoingTx: 0,
		// latestIncomingUserToUserPayment: 0,
		// latestOutgoingUserToUserPayment: 0,
		max_size: 10
	}
}

const parseOperationsResponse = (r: Types.GetUserOperationsResponse): { cursor: Types.GetUserOperationsRequest, operations: Types.UserOperation[], needMoreData: boolean } => {
	const cursor = {
		latestIncomingInvoice: r.latestIncomingInvoiceOperations.toIndex,
		latestOutgoingInvoice: r.latestOutgoingInvoiceOperations.toIndex,
		latestIncomingTx: r.latestIncomingTxOperations.toIndex,
		latestOutgoingTx: r.latestOutgoingTxOperations.toIndex,
		latestIncomingUserToUserPayment: r.latestIncomingUserToUserPayemnts.toIndex,
		latestOutgoingUserToUserPayment: r.latestOutgoingUserToUserPayemnts.toIndex,
		max_size: 10
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
	const needMoreData = isAnyArrayLong([
		r.latestIncomingInvoiceOperations.operations,
		r.latestOutgoingInvoiceOperations.operations,
		r.latestIncomingTxOperations.operations,
		r.latestOutgoingTxOperations.operations,
		r.latestIncomingUserToUserPayemnts.operations,
		r.latestOutgoingUserToUserPayemnts.operations,
	], 10)
	return { cursor, operations, needMoreData }
}

const isAnyArrayLong = (arrays: any[][], max: number): boolean => {
	for (let i = 0; i < arrays.length; i++) {
		const array = arrays[i];
		if (array.length >= max) {
			return true
		}
	}
	return false
}