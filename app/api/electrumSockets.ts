import net from "net";
import tls from "tls";

// electrum-client takes its sockets from these globals when it is loaded (so that it also runs in React Native),
// so this module has to be imported before it.
global.net = net;
global.tls = tls;
