//@flow

import type {
  CanvasPoint,
  TaskInterface,
  TaskRefInterface,
  TaskInterface,
  TransitionInterface,
} from '@stackstorm/st2flow-model/interfaces';
import type { NotificationInterface } from '@stackstorm/st2flow-notifications';
import type { Node } from 'react';

import React, { Component } from 'react';
import { connect } from 'react-redux';
import { PropTypes } from 'prop-types';
import cx from 'classnames';
import fp from 'lodash/fp';
import { uniqueId } from 'lodash';

import Notifications from '@stackstorm/st2flow-notifications';
import {HotKeys} from 'react-hotkeys';

import Task from './task';
import TransitionGroup from './transition';
import Vector from './vector';
import CollapseButton from './collapse-button';
import { Graph } from './astar';
import { ORBIT_DISTANCE } from './const';
import { Toolbar, ToolbarButton } from './toolbar';

import { origin } from './const';

import style from './style.css';

type DOMMatrix = {
  m11: number,
  m22: number
};

type Wheel = WheelEvent & {
  wheelDelta: number
}

@connect(
  ({ flow: { tasks, transitions, notifications, nextTask, panels, navigation }}) => ({ tasks, transitions, notifications, nextTask, isCollapsed: panels, navigation }),
  (dispatch) => ({
    issueModelCommand: (command, ...args) => {
      dispatch({
        type: 'MODEL_ISSUE_COMMAND',
        command,
        args,
      });
    },
    toggleCollapse: name => dispatch({
      type: 'PANEL_TOGGLE_COLLAPSE',
      name,
    }),
    navigate: (navigation) => dispatch({
      type: 'CHANGE_NAVIGATION',
      navigation,
    }),
  })
)
export default class Canvas extends Component<{
  children: Node,
      className?: string,

  navigation: Object,
  navigate: Function,

  tasks: Array<TaskInterface>,
  transitions: Array<Object>,
  notifications: Array<NotificationInterface>,
  issueModelCommand: Function,
  nextTask: string,

  isCollapsed: Object,
  toggleCollapse: Function,
}, {
      scale: number,
}> {
  static propTypes = {
    children: PropTypes.node,
    className: PropTypes.string,

    navigation: PropTypes.object,
    navigate: PropTypes.func,

    tasks: PropTypes.array,
    transitions: PropTypes.array,
    notifications: PropTypes.array,
    issueModelCommand: PropTypes.func,
    nextTask: PropTypes.string,

    isCollapsed: PropTypes.object,
    toggleCollapse: PropTypes.func,
  }

  state = {
    scale: 0,
  }

  componentDidMount() {
    const el = this.canvasRef.current;

    if (!el) {
      return;
    }

    el.addEventListener('wheel', this.handleMouseWheel);
    el.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('resize', this.handleUpdate);
    el.addEventListener('dragover', this.handleDragOver);
    el.addEventListener('drop', this.handleDrop);

    this.handleUpdate();
  }

  componentDidUpdate() {
    this.handleUpdate();
  }

  componentWillUnmount() {
    const el = this.canvasRef.current;

    if (!el) {
      return;
    }

    el.removeEventListener('wheel', this.handleMouseWheel);
    el.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('resize', this.handleUpdate);
    el.removeEventListener('dragover', this.handleDragOver);
    el.removeEventListener('drop', this.handleDrop);
  }

  size: CanvasPoint
  drag: boolean
  startx: number
  starty: number

  handleUpdate = () => {
    const canvasEl = this.canvasRef.current;
    const surfaceEl = this.surfaceRef.current;

    if (!canvasEl || !surfaceEl) {
      return;
    }

    const { tasks } = this.props;
    const { width, height } = canvasEl.getBoundingClientRect();

    const scale = Math.E ** this.state.scale;

    this.size = tasks.reduce((acc, item) => {
      const coords = new Vector(item.coords);
      const size = new Vector(item.size);
      const { x, y } = coords.add(size).add(50);

      return {
        x: Math.max(x, acc.x),
        y: Math.max(y, acc.y),
      };
    }, {
      x: width / scale,
      y: height / scale,
    });

    surfaceEl.style.width = `${(this.size.x).toFixed()}px`;
    surfaceEl.style.height = `${(this.size.y).toFixed()}px`;
  }

  handleMouseWheel = (e: Wheel): ?false => {
    // considerations on scale factor (BM, 2019-02-07)
    // on Chrome Mac and Safari Mac:
    // For Mac trackpads with continuous scroll, wheelDelta is reported in multiples of 3,
    //   but for a fast scoll, the delta value may be >1000.
    //   deltaY is always wheelDelta / -3.
    // For traditional mouse wheels with clicky scroll, wheelDelta is reported in multiples of 120.
    //   deltaY is non-integer and does not neatly gazinta wheelDelta.
    //
    // Firefox Mac:  wheelDelta is undefined. deltaY increments by 1 for trackpad or mouse wheel.
    //
    // On Windows w/Edge, I see a ratio of -20:7 between wheelDelta and deltaY. I'm using a VM, but the Mac
    //   trackpad and the mouse report the same ratio. (increments of 120:-42)
    // On Windows w/Chrome, the ratio is -6:5. The numbers don't seem to go above 360 for wheelDelta on a mousewheel
    //    or 600 for the trackpad
    //
    // Firefox Linux: wheelDelta is undefined, wheelY is always 3 or -3
    // Chromium Linus: wheelY is always in multiples of 53.  Fifty-three!  (wheelDelta is in multiples of 120)
    //   There's very little variation.  I can sometimes get the trackpad to do -212:480, but not a real mouse wheel
    const SCALE_FACTOR_MAC_TRACKPAD = .05;
    const SCROLL_FACTOR_MAC_TRACKPAD = 15;
    const SCALE_FACTOR_DEFAULT = .1;
    const SCROLL_FACTOR_DEFAULT = 30;

    const getModifierState = (e.getModifierState || function(mod) {
      mod = mod === 'Control' ? 'ctrl' : mod;
      return this[`${mod.toLowerCase()}Key`];
    }).bind(e);

    if(getModifierState('Control')) {
      e.preventDefault();
      const canvasEl = this.canvasRef.current;
      if(canvasEl instanceof HTMLElement) {
        const scrollFactor = e.wheelDelta && Math.abs(e.wheelDelta) < 120
          ? SCROLL_FACTOR_MAC_TRACKPAD
          : Math.abs(e.wheelDelta) < 3 ? SCROLL_FACTOR_DEFAULT / 2 : SCROLL_FACTOR_DEFAULT;
        canvasEl.scrollLeft += (e.deltaY < 0) ? -scrollFactor : scrollFactor;
      }

      return undefined;
    }

    if(getModifierState('Alt')) {
      e.preventDefault();
      e.stopPropagation();

      const { scale }: { scale: number } = this.state;
      const delta = Math.max(-1, Math.min(1, e.wheelDelta || -e.deltaY));

      // Zoom around the mouse pointer, by finding it's position normalized to the
      //  canvas and surface elements' coordinates, and moving the scroll on the
      //  canvas element to match the same proportions as before the scale.
      const canvasEl = this.canvasRef.current;
      const surfaceEl = this.surfaceRef.current;
      if(canvasEl instanceof HTMLElement && surfaceEl instanceof HTMLElement) {
        let canvasParentEl = canvasEl;
        let canvasOffsetLeft = 0;
        let canvasOffsetTop = 0;
        do {
          if(getComputedStyle(canvasParentEl).position !== 'static') {
            canvasOffsetLeft += canvasParentEl.offsetLeft || 0;
            canvasOffsetTop += canvasParentEl.offsetTop || 0;
          }
          canvasParentEl = canvasParentEl.parentNode;
        } while (canvasParentEl && canvasParentEl !== document);
        const surfaceScaleBefore: DOMMatrix = new window.DOMMatrix(getComputedStyle(surfaceEl).transform);
        const mousePosCanvasX = (e.clientX - canvasOffsetLeft) / canvasEl.clientWidth;
        const mousePosCanvasY = (e.clientY - canvasOffsetTop) / canvasEl.clientHeight;
        const mousePosSurfaceX = (e.clientX - canvasOffsetLeft + canvasEl.scrollLeft) /
                                  (surfaceEl.clientWidth * surfaceScaleBefore.m11);
        const mousePosSurfaceY = (e.clientY - canvasOffsetTop + canvasEl.scrollTop) /
                                  (surfaceEl.clientHeight * surfaceScaleBefore.m22);
        this.setState({
          scale: scale + delta * (e.wheelDelta && Math.abs(e.wheelDelta) < 120 ? SCALE_FACTOR_MAC_TRACKPAD: SCALE_FACTOR_DEFAULT),
        });

        const surfaceScaleAfter: DOMMatrix = new window.DOMMatrix(getComputedStyle(surfaceEl).transform);
        canvasEl.scrollLeft = surfaceEl.clientWidth * surfaceScaleAfter.m11 * mousePosSurfaceX -
                                canvasEl.clientWidth * mousePosCanvasX;
        canvasEl.scrollTop = surfaceEl.clientHeight * surfaceScaleAfter.m22 * mousePosSurfaceY -
                                canvasEl.clientHeight * mousePosCanvasY;
      }

      this.handleUpdate();

      return false;
    }
    else {
      return undefined;
    }
  }

  handleMouseDown = (e: MouseEvent) => {
    if (e.target !== this.surfaceRef.current) {
      return true;
    }

    e.preventDefault();
    e.stopPropagation();

    this.drag = true;

    const el = this.canvasRef.current;

    if (!el) {
      return true;
    }

    this.startx = e.clientX + el.scrollLeft;
    this.starty = e.clientY + el.scrollTop;

    return false;
  }

  handleMouseUp = (e: MouseEvent) => {
    if (!this.drag) {
      return true;
    }

    e.preventDefault();
    e.stopPropagation();

    this.drag = false;

    return false;
  }

  handleMouseMove = (e: MouseEvent) => {
    if (!this.drag) {
      return true;
    }

    e.preventDefault();
    e.stopPropagation();

    const el = this.canvasRef.current;

    if (!el) {
      return true;
    }

    el.scrollLeft += (this.startx - (e.clientX + el.scrollLeft));
    el.scrollTop += (this.starty - (e.clientY + el.scrollTop));

    return false;
  }

  handleDragOver = (e: DragEvent) => {
    if (e.target !== this.surfaceRef.current) {
      return true;
    }

    if (e.preventDefault) {
      e.preventDefault();
    }

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }

    return false;
  }

  handleDrop = (e: DragEvent) => {
    if (e.stopPropagation) {
      e.stopPropagation();
    }

    if (!e.dataTransfer) {
      return true;
    }

    const { action, handle } = JSON.parse(e.dataTransfer.getData('application/json'));

    const coords = new Vector(e.offsetX, e.offsetY).subtract(new Vector(handle)).subtract(new Vector(origin));

    this.props.issueModelCommand('addTask', {
      name: this.props.nextTask,
      action: action.ref,
      coords: Vector.max(coords, new Vector(0, 0)),
    });

    return false;
  }

  handleTaskMove = (task: TaskRefInterface, coords: CanvasPoint) => {
    this.props.issueModelCommand('updateTask', task, { coords });
  }

  handleTaskSelect = (task: TaskRefInterface) => {
    this.props.navigate({ task: task.name, toTasks: undefined, type: 'execution', section: 'input' });
  }

  handleTransitionSelect = (e: MouseEvent, transition: TransitionInterface) => {
    e.stopPropagation();
    this.props.navigate({ task: transition.from.name, toTasks: transition.to.map(t => t.name), type: 'execution', section: 'transitions' });
  }

  handleCanvasClick = (e: MouseEvent) => {
    e.stopPropagation();
    this.props.navigate({ task: undefined, toTasks: undefined, section: undefined, type: 'metadata' });
  }

  handleTaskEdit = (task: TaskRefInterface) => {
    this.props.navigate({ toTasks: undefined, task: task.name });
  }

  handleTaskDelete = (task: TaskRefInterface) => {
    this.props.issueModelCommand('deleteTask', task);
  }

  handleTaskConnect = (to: TaskRefInterface, from: TaskRefInterface) => {
    this.props.issueModelCommand('addTransition', { from, to: [ to ] });
  }

  handleTransitionDelete = (transition: TransitionInterface) => {
    this.props.issueModelCommand('deleteTransition', transition);
  }

  get notifications() : Array<NotificationInterface> {
    return this.props.notifications;
  }
  get errors() : Array<NotificationInterface> {
    return this.props.notifications.filter(n => n.type === 'error');
  }

  style = style
  canvasRef = React.createRef();
  surfaceRef = React.createRef();
  taskRefs = {};

  get transitionRoutingGraph(): Graph {
    const { taskRefs } = this;

    type BoundingBox = {|
      left: number,
      right: number,
      top: number,
      bottom: number,
      midpointX: number,
      midpointY: number,
    |};
    const boundingBoxes: Array<BoundingBox> = Object.keys(taskRefs).map((key: string): BoundingBox => {

      if(taskRefs[key].current) {
        const task: TaskInterface = taskRefs[key].current.props.task;

        const coords = new Vector(task.coords).add(origin);
        const size = new Vector(task.size);

        return {
          left: coords.x - ORBIT_DISTANCE,
          top: coords.y - ORBIT_DISTANCE,
          bottom: coords.y + size.y + ORBIT_DISTANCE,
          right: coords.x + size.x + ORBIT_DISTANCE,
          midpointY: coords.y + size.y / 2,
          midpointX: coords.x + size.x / 2,
        };
      }
      else {
        return {
          left: NaN,
          top: NaN,
          bottom: NaN,
          right: NaN,
          midpointY: NaN,
          midpointX: NaN,
        };
      }
    });

    /*  Let I be the set of interesting points (x, y) in the diagram, i.e. the connector
    points and corners of the bounding box of each object. Let XI be the set of x
    coordinates in I and YI the set of y coordinates in I. The orthogonal visibility
    graph V G = (V, E) is made up of nodes V ⊆ XI × YI s.t. (x, y) ∈ V iff there
    exists y0 s.t. (x, y0) ∈ I and there is no intervening object between (x, y) and
    (x, y0) and there exists x0 s.t. (x0, y) ∈ I and there is no intervening object
    between (x, y) and (x0, y). There is an edge e ∈ E between each point in V to its
    nearest neighbour to the north, south, east and west iff there is no intervening
    object in the original diagram */
    const border = {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    };
    const I = [].concat(...boundingBoxes.map(box => {
      if(box.left < border.left) {
        border.left = box.left;
      }
      if(box.right > border.right) {
        border.right = box.right;
      }
      if(box.top < border.top) {
        border.top = box.top;
      }
      if(box.bottom > border.bottom) {
        border.bottom = box.bottom;
      }

      return [
        { x: box.left, y: box.top },
        { x: box.left, y: box.bottom },
        { x: box.right, y: box.top },
        { x: box.right, y: box.bottom },
        // our connectors are currently at the midpoints of each edge.
        //  That can be changed here.
        { x: box.left, y: box.midpointY },
        { x: box.midpointX, y: box.top },
        { x: box.midpointX, y: box.bottom },
        { x: box.right, y: box.midpointY },
      ];
    })).concat([
      { x: border.left - ORBIT_DISTANCE, y: border.top - ORBIT_DISTANCE },
      { x: border.left - ORBIT_DISTANCE, y: border.bottom + ORBIT_DISTANCE },
      { x: border.right + ORBIT_DISTANCE, y: border.top - ORBIT_DISTANCE },
      { x: border.right + ORBIT_DISTANCE, y: border.bottom + ORBIT_DISTANCE },
    ]);
    const XI = I.reduce((a, i) => {
      a[i.x] = a[i.x] || [];
      a[i.x].push(i.y);
      return a;
    }, {});
    const YI = I.reduce((a, i) => {
      a[i.y] = a[i.y] || [];
      a[i.y].push(i.x);
      return a;
    }, {});
    const E = {};
    const V = [].concat(...Object.keys(XI).map(_x => {
      const x = +_x;
      return Object.keys(YI).filter(_y => {
        const y = +_y;
        // optimization: find nearest neighbor first.
        //  if nearest neighbors are blocked then all are.
        let nearestNeighborUp = -Infinity;
        let nearestNeighborDown = Infinity;
        let nearestNeighborLeft = -Infinity;
        let nearestNeighborRight = Infinity;
        YI[y].forEach(_x => {
          // x > _x means _x is to the left
          if(x !== _x) {
            if(x > _x && _x > nearestNeighborLeft) {
              nearestNeighborLeft = _x;
            }
            if(x < _x && _x < nearestNeighborRight) {
              nearestNeighborRight = _x;
            }
          }
        });
        XI[x].forEach(_y => {
          // y > _y means _y is above
          if(y !== _y) {
            if(y > _y && _y > nearestNeighborUp) {
              nearestNeighborUp = _y;
            }
            if(y < _y && _y < nearestNeighborDown) {
              nearestNeighborDown = _y;
            }
          }
        });

        boundingBoxes.forEach(box => {
          // Make visibility checks.  If a box is beween (x, y) and the nearest "interesting" neighbor,
          // (interesting neighbors are the points in I which share either an X or Y coordinate)
          // remove that nearest neighbor.
          if(nearestNeighborUp > -Infinity) {
            if(x > box.left && x < box.right && y > box.top && nearestNeighborUp < box.bottom) {
              nearestNeighborUp = -Infinity;
            }
          }
          if(nearestNeighborDown < Infinity) {
            if(x > box.left && x < box.right && y < box.bottom && nearestNeighborDown > box.top) {
              nearestNeighborDown = Infinity;
            }
          }
          if(nearestNeighborLeft > -Infinity) {
            if(y > box.top && y < box.bottom && x > box.left && nearestNeighborLeft < box.right) {
              nearestNeighborLeft = -Infinity;
            }
          }
          if(nearestNeighborRight < Infinity) {
            if(y > box.top && y < box.bottom && x < box.right && nearestNeighborRight > box.left) {
              nearestNeighborRight = Infinity;
            }
          }
        });

        if (XI[x].indexOf(y) > -1 ||
          +(nearestNeighborUp !== -Infinity) +
          +(nearestNeighborDown !== Infinity) +
          +(nearestNeighborLeft !== -Infinity) +
          +(nearestNeighborRight !== Infinity) > 1
        ) {
          E[`${x}|${y}`] = E[`${x}|${y}`] || [];
          if(nearestNeighborUp !== -Infinity) {
            // for what to put in the graph edges, now we want to look
            // at any point in V, not just interesting ones.
            // If there exists a point of interest (x, yi) such that there
            // is no bounding box intervening, then all points
            // (x, yj), y < yj < yi or y > yj > yi, will also not have a bounding
            // box intervening.
            nearestNeighborUp = Object.keys(YI).reduce((bestY, _yStr) => {
              const _y = +_yStr;
              return _y < y && _y > bestY ? _y : bestY;
            }, nearestNeighborUp);
            E[`${x}|${y}`].push({x, y: nearestNeighborUp});
          }
          if(nearestNeighborDown !== Infinity) {
            nearestNeighborDown = Object.keys(YI).reduce((bestY, _yStr) => {
              const _y = +_yStr;
              return _y > y && _y < bestY ? _y : bestY;
            }, nearestNeighborDown);
            E[`${x}|${y}`].push({x, y: nearestNeighborDown});
          }
          if(nearestNeighborLeft !== -Infinity) {
            nearestNeighborLeft = Object.keys(XI).reduce((bestX, _xStr) => {
              const _x = +_xStr;
              return _x < x && _x > bestX ? _x : bestX;
            }, nearestNeighborLeft);
            E[`${x}|${y}`].push({x: nearestNeighborLeft, y});
          }
          if(nearestNeighborRight !== Infinity) {
            nearestNeighborRight = Object.keys(XI).reduce((bestX, _xStr) => {
              const _x = +_xStr;
              return _x > x && _x < bestX ? _x : bestX;
            }, nearestNeighborRight);
            E[`${x}|${y}`].push({x: nearestNeighborRight, y});
          }
          return true;
        }
        else {
          return false;
        }
      }).map(y => ({ x, y: +y }));
    }));
    // filter out edges to nowhere
    Object.keys(E).forEach(eKey => {
      E[eKey] = E[eKey].filter(node => {
        return `${node.x}|${node.y}` in E;
      });
    });

    return new Graph(V, E);
  }

  render() {
    const { notifications, children, navigation, tasks=[], transitions=[], isCollapsed, toggleCollapse } = this.props;
    const { scale } = this.state;
    const { transitionRoutingGraph } = this;

    const surfaceStyle = {
      transform: `scale(${Math.E ** scale})`,
    };

    const transitionGroups = transitions
      .map(transition => {
        const from = {
          task: tasks.find(({ name }) => name === transition.from.name),
          anchor: 'bottom',
        };

        const group = transition.to.map(tto => {
          const to = {
            task: tasks.find(({ name }) => name === tto.name) || {},
            anchor: 'top',
          };

          return {
            from,
            to,
          };
        });

        return {
          id: uniqueId(`${transition.from.name}-`),
          transition,
          group,
          color: transition.color,
        };
      });

    const selectedTask = tasks.filter(task => task.name === navigation.task)[0];

    const selectedTransitionGroups = transitionGroups
      .filter(({ transition }) => {
        const { task, toTasks = [] } = navigation;
        return transition.from.name === task && fp.isEqual(toTasks, transition.to.map(t => t.name));
      });

    // Currently this component is registering global key handlers (attach = document.body)
    //   At some point it may be desirable to pull the global keyMap up to main.js (handlers
    //   can stay here), but for now since all key commands affect the canvas, this is fine.
    return (
      <HotKeys
        style={{height: '100%'}}
        focused={true}
        attach={document.body}
        handlers={{handleTaskDelete: e => {
          // This will break if canvas elements (tasks/transitions) become focus targets with
          //  tabindex or automatically focusing elements.  But in that case, the Task already
          //  has a handler for delete waiting.
          if(e.target === document.body) {
            e.preventDefault();
            if(selectedTask) {
              this.handleTaskDelete(selectedTask);
            }
          }
        }}}
      >
        <div
          className={cx(this.props.className, this.style.component)}
          onClick={e => this.handleCanvasClick(e)}
        >
          { children }
          <Toolbar position="right">
            <ToolbarButton key="zoomIn" icon="icon-zoom_in" onClick={() => this.setState({ scale: this.state.scale + .1 })} />
            <ToolbarButton key="zoomReset" icon="icon-zoom_reset" onClick={() => this.setState({ scale: 0 })} />
            <ToolbarButton key="zoomOut" icon="icon-zoom_out" onClick={() => this.setState({ scale: this.state.scale - .1 })} />
          </Toolbar>
          <CollapseButton position="left" state={isCollapsed.palette} onClick={() => toggleCollapse('palette')} />
          <CollapseButton position="right" state={isCollapsed.details} onClick={() => toggleCollapse('details')} />
          <div className={this.style.canvas} ref={this.canvasRef}>
            <div className={this.style.surface} style={surfaceStyle} ref={this.surfaceRef}>
              {
                tasks.map((task) => {
                  this.taskRefs[task.name] = this.taskRefs[task.name] || React.createRef();
                  return (
                    <Task
                      key={task.name}
                      task={task}
                      selected={task.name === navigation.task && !selectedTransitionGroups.length}
                      scale={scale}
                      onMove={(...a) => this.handleTaskMove(task, ...a)}
                      onConnect={(...a) => this.handleTaskConnect(task, ...a)}
                      onClick={() => this.handleTaskSelect(task)}
                      onDelete={() => this.handleTaskDelete(task)}
                      ref={this.taskRefs[task.name]}
                    />
                  );
                })
              }
              {
                transitionGroups
                  .filter(({ transition }) => {
                    const { task, toTasks = [] } = navigation;
                    return transition.from.name === task && fp.isEqual(toTasks, transition.to.map(t => t.name));
                  })
                  .map(({ transition }) => {
                    const toPoint = transition.to
                      .map(task => tasks.find(({ name }) => name === task.name))
                      .map(task => new Vector(task.size).multiply(new Vector(.5, 0)).add(new Vector(0, -10)).add(new Vector(task.coords)))
                      ;

                    const fromPoint = [ transition.from ]
                      .map((task: TaskRefInterface): any => tasks.find(({ name }) => name === task.name))
                      .map((task: TaskInterface) => new Vector(task.size).multiply(new Vector(.5, 1)).add(new Vector(task.coords)))
                      ;

                    const point = fromPoint.concat(toPoint)
                      .reduce((acc, point) => (acc || point).add(point).divide(2))
                      ;

                    const { x, y } = point.add(origin);
                    return (
                      <div
                        key={`${transition.from.name}-${window.btoa(transition.condition)}-selected`}
                        className={cx(this.style.transitionButton, this.style.delete, 'icon-delete')}
                        style={{ transform: `translate(${x}px, ${y}px)`}}
                        onClick={() => this.handleTransitionDelete(transition)}
                      />
                    );
                  })
              }
              {/*
                Here's a debug routing graph visualizer, in case you need to see how the graph is connected.
                ((graph) => {
                  return [ Object.keys(graph.grid).map(e => {
                    const [ x, y ] = e.split('|');
                    return graph.grid[e].map(et => {
                      const [ xt, yt ] = et.split('|');
                      return <path key={e+et} stroke="red" strokeWidth="1" d={`M ${x} ${y} L ${xt} ${yt}`} />;
                    });
                  }).concat(Object.values(graph.nodes).map((node) => {
                    const { x, y } = (node: any);
                    return <circle key={`${x}|${y}`} cx={x} cy={y} r="3" fill="black" />;
                  })) ];
                })(this.transitionRoutingGraph)
              */}
              <svg className={this.style.svg} xmlns="http://www.w3.org/2000/svg">
                {
                  transitionGroups
                    .map(({ id, transition, group, color }, i) => (
                      <TransitionGroup
                        key={`${id}-${window.btoa(transition.condition)}`}
                        color={color}
                        transitions={group}
                        taskRefs={this.taskRefs}
                        graph={transitionRoutingGraph}
                        selected={false}
                        onClick={(e) => this.handleTransitionSelect(e, transition)}
                      />
                    ))
                }
                {
                  selectedTransitionGroups
                    .map(({ id, transition, group, color }, i) => (
                      <TransitionGroup
                        key={`${id}-${window.btoa(transition.condition)}-selected`}
                        color={color}
                        transitions={group}
                        taskRefs={this.taskRefs}
                        graph={transitionRoutingGraph}
                        selected={true}
                        onClick={(e) => this.handleTransitionSelect(e, transition)}
                      />
                    ))
                }
              </svg>
            </div>
          </div>
          <Notifications position="bottom" notifications={notifications} />
        </div>
      </HotKeys>
    );
  }
}
