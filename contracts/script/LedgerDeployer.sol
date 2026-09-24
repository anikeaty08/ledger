// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMezoRouter} from "../src/interfaces/IMezo.sol";
import {ICreditPolicy, ITrancheVault, IBTCSwapper, IInvoiceRegistry, IAdvanceEngine, IReputationRegistry, ILedgerAccountFactory} from "../src/interfaces/ILedger.sol";
import {InvoiceRegistry} from "../src/invoices/InvoiceRegistry.sol";
import {ReceivableNFT} from "../src/invoices/ReceivableNFT.sol";
import {ReputationRegistry} from "../src/credit/ReputationRegistry.sol";
import {CreditPolicy} from "../src/credit/CreditPolicy.sol";
import {AdvanceEngine} from "../src/credit/AdvanceEngine.sol";
import {CollectionsManager} from "../src/credit/CollectionsManager.sol";
import {TrancheVault} from "../src/vaults/TrancheVault.sol";
import {BTCSwapper} from "../src/settlement/BTCSwapper.sol";
import {SettlementRouter} from "../src/settlement/SettlementRouter.sol";
import {SplitterFactory} from "../src/settlement/SplitterFactory.sol";
import {LedgerAccountFactory} from "../src/accounts/LedgerAccountFactory.sol";

/// @notice Deploys and wires the full Ledger suite. The caller context (prank / broadcast) must be `owner`.
abstract contract LedgerDeployer {
    struct External {
        address musd;
        address btcToken;
        bool wrapNative; // false on Mezo (native BTC == BTC ERC-20 precompile)
        address priceFeed;
        address mezoRouter;
        address poolFactory; // tigris PoolFactory used in the BTC→MUSD route
        bool stablePool;
        address borrowerOperations;
        address troveManager;
        address resolver;
        address treasury;
    }

    struct Suite {
        InvoiceRegistry registry;
        ReceivableNFT receivable;
        ReputationRegistry reputation;
        CreditPolicy policy;
        TrancheVault senior;
        TrancheVault junior;
        BTCSwapper swapper;
        AdvanceEngine engine;
        LedgerAccountFactory accounts;
        SettlementRouter router;
        CollectionsManager collections;
        SplitterFactory splitters;
    }

    function _deployLedger(address owner, External memory ext) internal returns (Suite memory s) {
        s.registry = new InvoiceRegistry(owner);
        s.receivable = s.registry.receivableNFT();
        s.reputation = new ReputationRegistry(owner);
        s.policy = new CreditPolicy(owner, IReputationRegistry(address(s.reputation)));
        s.senior = new TrancheVault(IERC20(ext.musd), "Ledger Senior MUSD", "lsMUSD", owner, 0);
        s.junior = new TrancheVault(IERC20(ext.musd), "Ledger Junior MUSD", "ljMUSD", owner, 7 days);

        IMezoRouter.Route[] memory route = new IMezoRouter.Route[](1);
        route[0] = IMezoRouter.Route(ext.btcToken, ext.musd, ext.stablePool, ext.poolFactory);
        s.swapper = new BTCSwapper(
            owner,
            IPriceFeed(ext.priceFeed),
            IMezoRouter(ext.mezoRouter),
            ext.btcToken,
            ext.musd,
            ext.wrapNative,
            route
        );

        s.engine = new AdvanceEngine(
            owner,
            IERC20(ext.musd),
            IInvoiceRegistry(address(s.registry)),
            ITrancheVault(address(s.senior)),
            ITrancheVault(address(s.junior)),
            ICreditPolicy(address(s.policy)),
            IBTCSwapper(address(s.swapper))
        );
        s.accounts = new LedgerAccountFactory(
            owner,
            IBorrowerOperations(ext.borrowerOperations),
            ITroveManager(ext.troveManager),
            IPriceFeed(ext.priceFeed),
            IERC20(ext.musd)
        );
        s.router = new SettlementRouter(
            owner,
            IERC20(ext.musd),
            IInvoiceRegistry(address(s.registry)),
            IAdvanceEngine(address(s.engine)),
            IReputationRegistry(address(s.reputation)),
            IBTCSwapper(address(s.swapper)),
            ILedgerAccountFactory(address(s.accounts))
        );
        s.collections = new CollectionsManager(
            owner,
            IInvoiceRegistry(address(s.registry)),
            IAdvanceEngine(address(s.engine)),
            IReputationRegistry(address(s.reputation)),
            ext.resolver
        );
        s.splitters = new SplitterFactory();

        // Wiring
        s.registry.setModule(address(s.engine), true);
        s.registry.setModule(address(s.router), true);
        s.registry.setModule(address(s.collections), true);
        s.reputation.setWriter(address(s.router), true);
        s.reputation.setWriter(address(s.collections), true);
        s.senior.setEngine(address(s.engine));
        s.junior.setEngine(address(s.engine));
        s.engine.setModules(
            address(s.router),
            address(s.collections),
            ICreditPolicy(address(s.policy)),
            IBTCSwapper(address(s.swapper)),
            ext.treasury
        );
        s.accounts.setRouter(address(s.router));
    }
}
