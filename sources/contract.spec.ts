import { buildOnchainMetadata } from "./utils/jetton-helpers";
import {
    Blockchain,
    SandboxContract,
    TreasuryContract,
    printTransactionFees,
    prettyLogTransactions,
    RemoteBlockchainStorage,
    wrapTonClient4ForRemote,
} from "@ton/sandbox";
import "@ton/test-utils";
import { Address, beginCell, fromNano, StateInit, toNano } from "@ton/core";
import { TonClient4 } from "@ton/ton";
import { printSeparator } from "./utils/print";

// -------- Contract SDK --------
import { SampleJetton, Mint, TokenTransfer } from "./output/SampleJetton_SampleJetton";
import { JettonDefaultWallet, TokenBurn } from "./output/SampleJetton_JettonDefaultWallet";

// -------- DeDust.io SDK --------
// import {
//     Asset,
//     Factory,
//     MAINNET_FACTORY_ADDR,
//     PoolType,
//     Vault,
//     LiquidityDeposit,
//     VaultJetton,
//     JettonRoot,
//     ReadinessStatus,
// } from "@dedust/sdk";

// ------------ STON.fi SDK ------------
import TonWeb from "tonweb";
import { DEX, pTON } from "@ston-fi/sdk";

const jettonParams = {
    name: "AI Jetton",
    description: "5% commission Jetton",
    symbol: "AITON",
    image: "https://gateway.pinata.cloud/ipfs/QmdKpdkk4YgJnrruQVi7C6ocBAzZ1P3N5ZcRbjXihJYDeq",
};
let content = buildOnchainMetadata(jettonParams);
let max_supply = toNano(123456766689011); // Set the specific total supply in nano

describe("contract", () => {
    let blockchain: Blockchain;
    let token: SandboxContract<SampleJetton>;
    let jettonWallet: SandboxContract<JettonDefaultWallet>;
    let deployer: SandboxContract<TreasuryContract>;
    // let player: SandboxContract<TreasuryContract>;

    beforeAll(async () => {
        // Create content Cell

        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury("deployer");
        // player = await blockchain.treasury("player");

        token = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content, max_supply));

        // Send Transaction
        const deployResult = await token.send(deployer.getSender(), { value: toNano("10") }, "Mint: 100");
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: token.address,
            deploy: true,
            success: true,
        });

        const playerWallet = await token.getGetWalletAddress(deployer.address);
        jettonWallet = blockchain.openContract(await JettonDefaultWallet.fromAddress(playerWallet));
    });

    it("Test: Minting is successfully", async () => {
        const totalSupplyBefore = (await token.getGetJettonData()).total_supply;
        const mintAmount = toNano(100);
        const Mint: Mint = {
            $$type: "Mint",
            amount: mintAmount,
            receiver: deployer.address,
        };
        const mintResult = await token.send(deployer.getSender(), { value: toNano("10") }, Mint);
        expect(mintResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: token.address,
            success: true,
        });
        // printTransactionFees(mintResult.transactions);

        const totalSupplyAfter = (await token.getGetJettonData()).total_supply;
        expect(totalSupplyBefore + mintAmount).toEqual(totalSupplyAfter);

        const walletData = await jettonWallet.getGetWalletData();
        expect(walletData.owner).toEqualAddress(deployer.address);
        expect(walletData.balance).toBeGreaterThanOrEqual(mintAmount);
    });

    it("should transfer successfully", async () => {
        const sender = await blockchain.treasury("sender");
        const receiver = await blockchain.treasury("receiver");
        const initMintAmount = toNano(1000);
        const transferAmount = toNano(80);
        const fee_des_address = "EQBaMZGIjUaGio1-SrG4Wj6SzQC_g5yb4gSpZKK7hRlwHxuK";

        const mintMessage: Mint = {
            $$type: "Mint",
            amount: initMintAmount,
            receiver: sender.address,
        };
        await token.send(deployer.getSender(), { value: toNano("0.25") }, mintMessage);

        const senderWalletAddress = await token.getGetWalletAddress(sender.address);
        const senderWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(senderWalletAddress));

        // Transfer tokens from sender's wallet to receiver's wallet // 0xf8a7ea5
        const transferMessage: TokenTransfer = {
            $$type: "TokenTransfer",
            query_id: 0n,
            amount: transferAmount,
            sender: receiver.address,
            response_destination: sender.address,
            custom_payload: null,
            forward_ton_amount: toNano("0.1"),
            forward_payload: beginCell().storeUint(0, 1).storeUint(0, 32).endCell(),
        };
        const transferResult = await senderWallet.send(sender.getSender(), { value: toNano("0.5") }, transferMessage);
        expect(transferResult.transactions).toHaveTransaction({
            from: sender.address,
            to: senderWallet.address,
            success: true,
        });
        printTransactionFees(transferResult.transactions);
        prettyLogTransactions(transferResult.transactions);

        const senderWalletDataAfterTransfer = await senderWallet.getGetWalletData();
        
        const receiverWalletAddress = await token.getGetWalletAddress(receiver.address);
        const receiverWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(receiverWalletAddress));
        const receiverWalletDataAfterTransfer = await receiverWallet.getGetWalletData();

        const jettonOwnerDataAfterTransfer = await jettonWallet.getGetWalletData();

        expect(senderWalletDataAfterTransfer.balance).toEqual(initMintAmount - transferAmount); // check that the sender transferred the right amount of tokens

        expect(receiverWalletDataAfterTransfer.balance).toEqual(transferAmount); // check that the receiver received the right amount of tokens
        expect(jettonOwnerDataAfterTransfer.balance).toEqual(100n + toNano(100));

        const balance1 = (await receiverWallet.getGetWalletData()).balance;
        console.log(fromNano(balance1));
    });

    it("Mint tokens then Burn tokens", async () => {
        // const sender = await blockchain.treasury("sender");
        const deployerWalletAddress = await token.getGetWalletAddress(deployer.address);
        const deployerWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(deployerWalletAddress));
        let deployerBalanceInit = (await deployerWallet.getGetWalletData()).balance;

        const initMintAmount = toNano(100);
        const mintMessage: Mint = {
            $$type: "Mint",
            amount: initMintAmount,
            receiver: deployer.address,
        };
        await token.send(deployer.getSender(), { value: toNano("10") }, mintMessage);
        let deployerBalance = (await deployerWallet.getGetWalletData()).balance;
        expect(deployerBalance).toEqual(deployerBalanceInit + initMintAmount);

        let burnAmount = toNano(10);
        const burnMessage: TokenBurn = {
            $$type: "TokenBurn",
            query_id: 0n,
            amount: burnAmount,
            response_destination: deployer.address,
            custom_payload: beginCell().endCell(),
        };

        await deployerWallet.send(deployer.getSender(), { value: toNano("10") }, burnMessage);
        let deployerBalanceAfterBurn = (await deployerWallet.getGetWalletData()).balance;
        expect(deployerBalanceAfterBurn).toEqual(deployerBalance - burnAmount);
    });

    it("Should return value", async () => {
        const player = await blockchain.treasury("player");
        const mintAmount = 1119000n;
        const Mint: Mint = {
            $$type: "Mint",
            amount: mintAmount,
            receiver: player.address,
        };
        await token.send(deployer.getSender(), { value: toNano("1") }, Mint);

        let totalSupply = (await token.getGetJettonData()).total_supply;
        const messateResult = await token.send(player.getSender(), { value: 10033460n }, Mint);
        expect(messateResult.transactions).toHaveTransaction({
            from: player.address,
            to: token.address,
        });
        let totalSupply_later = (await token.getGetJettonData()).total_supply;
        expect(totalSupply_later).toEqual(totalSupply);

        // printTransactionFees(messateResult.transactions);
        // prettyLogTransactions(messateResult.transactions);
    });


    it("Onchian Testing: STON.fi", async () => {

        const AITON_address = "EQDR6X8-X4gJxNipjwteTOkdwdcmiAwGYG6Dd3RJ9aEpgWyI";
        const pTON_address = new pTON.v1().address;

        const client = new TonClient4({
            // endpoint: "https://sandbox-v4.tonhubapi.com",
            endpoint: "https://mainnet-v4.tonhubapi.com",
        });

        const router = client.open(new DEX.v1.Router());
        
        console.log('router.address', router.address);

        const routerData = await router.getRouterData();
        const { isLocked, adminAddress, tempUpgrade, poolCode, jettonLpWalletCode, lpAccountCode } = routerData;

        console.log('router adminAddress', adminAddress);
        
        const pool = client.open(await router.getPool({
            token0: AITON_address,
            token1: pTON_address,
        }));

        console.log('pool address', pool.address);

        const poolData = await pool.getPoolData();
        const {
            reserve0,
            reserve1,
            token0WalletAddress,
            token1WalletAddress,
            lpFee,
            protocolFee,
            refFee,
            protocolFeeAddress,
            collectedToken0ProtocolFee,
            collectedToken1ProtocolFee,
        } = poolData;

        console.log('reserve0', reserve0);
        console.log('reserve1', reserve1);
    });
});
