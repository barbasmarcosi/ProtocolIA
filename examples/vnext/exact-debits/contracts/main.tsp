import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Exact Balance Posting" })
namespace ExactBalancePosting {
  @entity @view("Saldos")
  model Wallet {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    walletCode: string;
    @minLength(1) @maxLength(80)
    name: string;
    @uiLabel("Saldo disponible")
    @encode(string) @exactDecimal(24,2,"0")
    available: decimal;
  }
  @entity @view("Cargos")
  model Charge {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    chargeNumber: string;
    @reference("Wallet","restrict") @minLength(1) @maxLength(40)
    walletCode: string;
    @uiLabel("Importe")
    @encode(string) @exactDecimal(24,2,"0.01")
    amount: decimal;
    @initial("posted") @minLength(1) @maxLength(20)
    status: string;
  }
  model WalletRequest {
    @minLength(1) @maxLength(40) walletCode: string;
    @minLength(1) @maxLength(80) name: string;
    @encode(string) @exactDecimal(24,2,"0") available: decimal;
  }
  model ChargeRequest {
    @minLength(1) @maxLength(40) chargeNumber: string;
    @minLength(1) @maxLength(40) walletCode: string;
    @encode(string) @exactDecimal(24,2,"0.01") amount: decimal;
  }
  model WalletPage { items: Wallet[]; @minValue(1) @maxValue(50) limit: int32; @minValue(0) offset: int32; @minValue(0) total: int32; }
  model ChargePage { items: Charge[]; @minValue(1) @maxValue(50) limit: int32; @minValue(0) offset: int32; @minValue(0) total: int32; }
  model Health { status: string; }
  @error model BadRequest { @statusCode _: 400; message: string; }
  @error model Conflict { @statusCode _: 409; message: string; }
  @error model NotFound { @statusCode _: 404; message: string; }
  @error model Unauthorized { @statusCode _: 401; message: string; }
  @error model Forbidden { @statusCode _: 403; message: string; }

  @route("/api/wallets") @post @behavior("create","Wallet") @capability("wallets.write")
  op createWallet(@body input: WalletRequest):
    { @statusCode _: 201; @body wallet: Wallet; } | BadRequest | Conflict | Unauthorized | Forbidden;
  @route("/api/wallets/{walletCode}") @get @behavior("get","Wallet") @capability("wallets.read")
  op getWallet(@path walletCode: string): Wallet | NotFound | Unauthorized | Forbidden;
  @route("/api/wallets") @get @behavior("listPage","Wallet") @capability("wallets.read")
  op listWallets(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0):
    WalletPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/charges") @post @behavior("create","Charge")
  @debitExact("Wallet","available","walletCode","amount")
  @audit("amount")
  @capability("charges.write")
  op createCharge(@body input: ChargeRequest):
    { @statusCode _: 201; @body charge: Charge; } | BadRequest | Conflict | Unauthorized | Forbidden;
  @route("/api/charges/{chargeNumber}/reverse") @post
  @behavior("transition","Charge","status")
  @transition("posted","reversed")
  @reverseExact("Wallet","available","walletCode","amount")
  @audit("status") @capability("charges.write")
  op reverseCharge(@path chargeNumber: string):
    Charge | BadRequest | Conflict | NotFound | Unauthorized | Forbidden;
  @route("/api/charges/{chargeNumber}") @get @behavior("get","Charge") @capability("charges.read")
  op getCharge(@path chargeNumber: string): Charge | NotFound | Unauthorized | Forbidden;
  @route("/api/charges") @get @behavior("listPage","Charge") @capability("charges.read")
  op listCharges(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0):
    ChargePage | BadRequest | Unauthorized | Forbidden;
  @route("/health") @get @behavior("health","Wallet") @capability("public")
  op health(): Health;
}
