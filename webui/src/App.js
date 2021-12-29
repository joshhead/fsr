import React, { useRef, useState, useEffect, useCallback } from 'react';

import logo from './logo.svg';
import './App.css';

import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'

import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'

import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'

import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link
} from "react-router-dom";

// How many historical readings to retain for plotting sensor values
const max_size = 1000;

function useServerConnection() {

  // The number of sensors, as determined by the number of values in the latest
  // kCurValuesRef
  const [numSensors, setNumSensors] = useState(0);

  // Keep track of the current thresholds (initially fetched from the backend).
  const kCurThresholdsRef = useRef(undefined);

  // A history of the past 'max_size' values fetched from the backend.
  // Used for plotting and displaying live values.
  // We use a cyclical array to save memory.
  const kCurValuesRef = useRef([]);
  const kCurValuesIndexRef = useRef(-1);

  const wsRef = useRef();
  const wsCallbacksRef = useRef({});
  const wsQueueRef = useRef([]);

  const emit = useCallback((msg) => {
    // Queue the message if the websocket connection is not ready yet.
    // The states are CONNECTING (0), OPEN (1), CLOSING (2) and CLOSED (3).
    if (!wsRef.current || wsRef.current.readyState !== 1 /* OPEN */) {
      wsQueueRef.current.push(msg);
      return;
    }

    wsRef.current.send(JSON.stringify(msg));
  });

  wsCallbacksRef.current.values = function(msg) {
    kCurValuesIndexRef.current = (kCurValuesIndexRef.current + 1) % max_size
    kCurValuesRef.current[kCurValuesIndexRef.current] = msg.values;
    setNumSensors(msg.values.length);
  };

  wsCallbacksRef.current.thresholds = function(msg) {
    kCurThresholdsRef.current = msg.thresholds;
  };

  useEffect(() => {
    let cleaningUp = false;
    let reconnectTimeoutId = 0;

    function connect() {
      wsRef.current = new WebSocket('ws://' + window.location.host + '/ws');

      wsRef.current.addEventListener('open', function(ev) {
        while (wsQueueRef.current.length > 0 && wsRef.current.readyState === 1) {
          let msg = wsQueueRef.current.shift();
          wsRef.current.send(JSON.stringify(msg));
        }
      });

      wsRef.current.addEventListener('error', function(ev) {
        wsRef.current.close();
      });

      wsRef.current.addEventListener('close', function(ev) {
        if (!cleaningUp) {
          reconnectTimeoutId = setTimeout(connect, 1000);
        }
      });

      wsRef.current.addEventListener('message', function(ev) {
        const data = JSON.parse(ev.data)
        const action = data[0];
        const msg = data[1];

        if (wsCallbacksRef.current[action]) {
          wsCallbacksRef.current[action](msg);
        }
      });
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeoutId);
      cleaningUp = true;
      wsRef.current.close();
    };
  });

  return { emit, numSensors, kCurThresholdsRef, kCurValuesRef, kCurValuesIndexRef };
}

// An interactive display of the current values obtained by the backend.
// Also has functionality to manipulate thresholds.
function ValueMonitor(props) {
  const { emit, kCurThresholdsRef, kCurValuesRef, kCurValuesIndexRef } = props;
  const index = parseInt(props.index)
  const thresholdLabelRef = useRef(null);
  const valueLabelRef = useRef(null);
  const canvasRef = useRef(null);

  function EmitValue(val) {
    // Send back all the thresholds instead of a single value per sensor. This is in case
    // the server restarts where it would be nicer to have all the values in sync.
    // Still send back the index since we want to update only one value at a time
    // to the microcontroller.
    emit(['update_threshold', kCurThresholdsRef.current, index]);
  }

  function Decrement(e) {
    const val = kCurThresholdsRef.current[index] - 1;
    if (val >= 0) {
      kCurThresholdsRef.current[index] = val;
      EmitValue(val);
    }
  }

  function Increment(e) {
    const val = kCurThresholdsRef.current[index] + 1;
    if (val <= 1023) {
      kCurThresholdsRef.current[index] = val
      EmitValue(val);
    }
  }

  useEffect(() => {
    let requestId;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function getMousePos(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const dpi = window.devicePixelRatio || 1;
      return {
        x: (e.clientX - rect.left) * dpi,
        y: (e.clientY - rect.top) * dpi
      };
    }

    function getTouchPos(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const dpi = window.devicePixelRatio || 1;
      return {
        x: (e.targetTouches[0].pageX - rect.left - window.pageXOffset) * dpi,
        y: (e.targetTouches[0].pageY - rect.top - window.pageYOffset) * dpi
      };
    }
    // Change the thresholds while dragging, but only emit on release.
    let is_drag = false;

    // Mouse Events
    canvas.addEventListener('mousedown', function(e) {
      let pos = getMousePos(canvas, e);
      kCurThresholdsRef.current[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('mouseup', function(e) {
      EmitValue(kCurThresholdsRef.current[index]);
      is_drag = false;
    });

    canvas.addEventListener('mousemove', function(e) {
      if (is_drag) {
        let pos = getMousePos(canvas, e);
        kCurThresholdsRef.current[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    // Touch Events
    canvas.addEventListener('touchstart', function(e) {
      let pos = getTouchPos(canvas, e);
      kCurThresholdsRef.current[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      is_drag = true;
    });

    canvas.addEventListener('touchend', function(e) {
      // We don't need to get the 
      EmitValue(kCurThresholdsRef.current[index]);
      is_drag = false;
    });

    canvas.addEventListener('touchmove', function(e) {
      if (is_drag) {
        let pos = getTouchPos(canvas, e);
        kCurThresholdsRef.current[index] = Math.floor(1023 - pos.y/canvas.height * 1023);
      }
    });

    const setDimensions = () => {
      // Adjust DPI so that all the edges are smooth during scaling.
      const dpi = window.devicePixelRatio || 1;

      canvas.width = canvas.clientWidth * dpi;
      canvas.height = canvas.clientHeight * dpi;
    };

    setDimensions();
    window.addEventListener('resize', setDimensions);

    // This is default React CSS font style.
    const bodyFontFamily = window.getComputedStyle(document.body).getPropertyValue("font-family");
    const valueLabel = valueLabelRef.current;
    const thresholdLabel = thresholdLabelRef.current;

    // cap animation to 60 FPS (with slight leeway because monitor refresh rates are not exact)
    const minFrameDurationMs = 1000 / 60.1;
    var previousTimestamp;

    const render = (timestamp) => {
      if (previousTimestamp && (timestamp - previousTimestamp) < minFrameDurationMs) {
        requestId = requestAnimationFrame(render);
        return;
      }
      previousTimestamp = timestamp;

      // Get the latest value, based off of the circular array.
      let currentValue = kCurValuesRef.current[kCurValuesIndexRef.current][index];

      // Add background fill.
      let grd = ctx.createLinearGradient(canvas.width/2, 0, canvas.width/2 ,canvas.height);
      if (currentValue >= kCurThresholdsRef.current[index]) {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'blue');
      } else {
        grd.addColorStop(0, 'lightblue');
        grd.addColorStop(1, 'gray');
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cur Value Label
      valueLabel.innerText = currentValue;

      // Bar
      const maxHeight = canvas.height;
      const position = Math.round(maxHeight - currentValue/1023 * maxHeight);
      grd = ctx.createLinearGradient(canvas.width/2, canvas.height, canvas.width/2, position);
      grd.addColorStop(0, 'orange');
      grd.addColorStop(1, 'red');
      ctx.fillStyle = grd;
      ctx.fillRect(canvas.width/4, position, canvas.width/2, canvas.height);

      // Threshold Line
      const threshold_height = 3
      const threshold_pos = (1023-kCurThresholdsRef.current[index])/1023 * canvas.height;
      ctx.fillStyle = "black";
      ctx.fillRect(0, threshold_pos-Math.floor(threshold_height/2), canvas.width, threshold_height);

      // Threshold Label
      thresholdLabel.innerText = kCurThresholdsRef.current[index];
      ctx.font = "30px " + bodyFontFamily;
      ctx.fillStyle = "black";
      if (kCurThresholdsRef.current[index] > 990) {
        ctx.textBaseline = 'top';
      } else {
        ctx.textBaseline = 'bottom';
      }
      ctx.fillText(kCurThresholdsRef.current[index].toString(), 0, threshold_pos + threshold_height + 1);

      requestId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(requestId);
      window.removeEventListener('resize', setDimensions);
    };
  // Intentionally disable the lint errors.
  // EmitValue and index don't need to be in the dependency list as we only want this to 
  // run once. The canvas will automatically update via requestAnimationFrame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return(
    <Col style={{height: '75vh', paddingTop: '1vh'}}>
      <Button variant="light" size="sm" onClick={Decrement}><b>-</b></Button>
      <span> </span>
      <Button variant="light" size="sm" onClick={Increment}><b>+</b></Button>
      <br />
      <Form.Label ref={thresholdLabelRef}>0</Form.Label>
      <br />
      <Form.Label ref={valueLabelRef}>0</Form.Label>
      <canvas
        ref={canvasRef}
        style={{border: '1px solid white', width: '100%', height: '100%', touchAction: "none"}} />
    </Col>
  );
}

function WebUI(props) {
  const { numSensors } = props;
  return (
    <header className="App-header">
      <Container fluid style={{border: '1px solid white', height: '100vh'}}>
        <Row>
          {[...Array(numSensors).keys()].map(value_monitor => (
          	<ValueMonitor index={value_monitor} {...props} />)
          )}
        </Row>
      </Container>
    </header>
  );
}

function Plot() {
  return <div>Plot</div>
}

function App() {
  const serverConnectionProps = useServerConnection();

  return (
    <div className="App">
      <Router>
        <Navbar bg="light">
          <Navbar.Brand as={Link} to="/">FSR WebUI</Navbar.Brand>
          <Nav>
            <Nav.Item>
              <Nav.Link as={Link} to="/plot">Plot</Nav.Link>
            </Nav.Item>
          </Nav>
          <Nav className="ml-auto">
          </Nav>
        </Navbar>
        <Switch>
          <Route exact path="/">
            <WebUI {...serverConnectionProps} />
          </Route>
          <Route path="/plot">
            <Plot />
          </Route>
        </Switch>
      </Router>
    </div>
  );
}

export default App;
