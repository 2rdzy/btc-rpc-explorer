// electrum-client (the 2rdzy fork) ships no type declarations: this is loose until it does.
declare module "electrum-client" {
	const ElectrumClient: any;
	export = ElectrumClient;
}
