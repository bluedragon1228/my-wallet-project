import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { SpendFrom } from '../../globalTypes';
import { NOSTR_PUB_DESTINATION, options } from '../../constants';

const getSpendFromLocal = localStorage.getItem("spendFrom");

const update = (value: SpendFrom[]) => {
  localStorage.setItem("spendFrom", JSON.stringify(value));
}

const initialState: SpendFrom[] = JSON.parse(getSpendFromLocal??"[]").length!==0?
    JSON.parse(getSpendFromLocal??"[]")
    :
    [
      {
        id: 0,
        label: "Bootstrap Node",
        pasteField: NOSTR_PUB_DESTINATION,
        option: options.little,
        icon: "0",
        balance: "0",
      }
    ];

const spendSourcesSlice = createSlice({
  name: 'spendSources',
  initialState,
  reducers: {
    addSpendSources: (state, action: PayloadAction<SpendFrom>) => {
      state.push(action.payload);
      update(state);
    },
    editSpendSources: (state, action: PayloadAction<SpendFrom>) => {
      const id = action.payload.id;
      state[id] = action.payload;
      update(state);
    },
    deleteSpendSources: (state, action: PayloadAction<number>) => {
      state.splice(action.payload, 1)
      update(state);
    },
    setSpendSources: (state, action: PayloadAction<SpendFrom[]>) => {
      state = action.payload.map((e:any)=>{return {...e}});
      update(state);
    },
  },
});

export const { addSpendSources, editSpendSources, deleteSpendSources, setSpendSources } = spendSourcesSlice.actions;
export default spendSourcesSlice.reducer;
