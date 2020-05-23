import {
  h,
  inject,
  provide,
  defineComponent,
  PropType,
  computed,
  ComponentPublicInstance,
  warn,
  Comment,
  VNode,
  shallowRef,
  VNodeArrayChildren,
  cloneVNode,
  VNodeProps,
  watch,
  toRefs,
} from 'vue'
import { RouteLocationNormalizedLoaded, RouteLocationNormalized } from './types'
import {
  matchedRouteKey,
  viewDepthKey,
  routeLocationKey,
} from './injectionSymbols'

export interface RouterViewProps {
  name?: string
  // allow looser type for user facing api
  route?: RouteLocationNormalized
}

export const RouterViewImpl = defineComponent({
  name: 'RouterView',
  props: {
    name: {
      type: String as PropType<string>,
      default: 'default',
    },
    route: Object as PropType<RouteLocationNormalizedLoaded>,
  },

  setup(props, { attrs, slots }) {
    const realRoute = inject(routeLocationKey)!
    const route = computed(() => props.route || realRoute)

    const depth: number = inject(viewDepthKey, 0)
    provide(viewDepthKey, depth + 1)

    const matchedRoute = computed(
      () =>
        route.value.matched[depth] as
          | RouteLocationNormalizedLoaded['matched'][any]
          | undefined
    )
    const ViewComponent = computed(
      () => matchedRoute.value && matchedRoute.value.components[props.name]
    )

    const propsData = computed(() => {
      // propsData only gets called if ViewComponent.value exists and it depends
      // on matchedRoute.value
      const { props } = matchedRoute.value!
      if (!props) return {}
      // this means that if the user hasn't defined all props defined as params,
      // they will have extra attribute inherited by their component
      if (props === true) return route.value.params

      return typeof props === 'object' ? props : props(route.value)
    })

    // passed to onBeforeRoute* guards
    provide(matchedRouteKey, matchedRoute)

    const viewRef = shallowRef<ComponentPublicInstance>()

    watch(
      [viewRef, matchedRoute, toRefs(props).name] as const,
      (
        [instance, currentMatched, name],
        [_prevInstance, prevMatched, prevName]
      ) => {
        console.log('watch', name, currentMatched, instance)
        // clear previous instance
        if (
          prevMatched &&
          prevName &&
          (currentMatched !== prevMatched || name !== prevName)
        )
          prevMatched.instances[prevName] = null
        if (currentMatched) currentMatched.instances[name] = instance
      },
      { immediate: false }
    )

    return () => {
      // function onVnodeMounted() {
      // console.log('mount', currentMatched, currentName, viewRef.value)
      // usually if we mount, there is a matched record, but that's not true
      // when using the v-slot api. When dealing with transitions, they can
      // initially not render anything, so the ref can be empty. That's why we
      // add a onVnodeUpdated hook
      // if (currentMatched && viewRef.value)
      // currentMatched.instances[currentName] = viewRef.value
      // TODO: trigger beforeRouteEnter callbacks but doesn't work with keep alive, it needs activated
      // }

      function onVnodeUnmounted() {
        const currentMatched = matchedRoute.value
        console.log('unmount', props.name)
        if (currentMatched) {
          // remove the instance reference to prevent leak
          currentMatched.instances[props.name] = null
        }
      }

      let Component = ViewComponent.value
      const componentProps: Parameters<typeof h>[1] = {
        // only compute props if there is a matched record
        ...(Component && propsData.value),
        ...attrs,
        onVnodeUnmounted,
        ref: viewRef,
      }

      // NOTE: we could also not render if there is no route match
      const children =
        slots.default &&
        slots
          .default({ Component, route })
          .filter(vnode => vnode.type !== Comment)

      if (children) {
        if (__DEV__ && children.length > 1) {
          warn(
            `RouterView accepts exactly one child as its slot but it received ${children.length} children. The first child will be used while the rest will be ignored.`
          )
        }
        let child: VNode | undefined = children[0]
        if (!child) return null

        if (isKeepAlive(child)) {
          // get the inner child if we have a keep-alive
          let innerChild = getKeepAliveChild(child)
          if (!innerChild) return null

          // we need to detect when keep alive unmounts instead
          delete componentProps.onVnodeUnmounted

          // we know the array exists because innerChild exists
          ;(child.children as VNodeArrayChildren)[0] = cloneVNode(
            innerChild,
            componentProps
          )
          return cloneVNode(child, { onVnodeUnmounted })
        } else {
          return cloneVNode(child, componentProps)
        }
      }

      return Component ? h(Component, componentProps) : null
    }
  },
})

function getKeepAliveChild(vnode: VNode): VNode | undefined {
  return isKeepAlive(vnode)
    ? vnode.children
      ? ((vnode.children as VNodeArrayChildren)[0] as VNode)
      : undefined
    : vnode
}

export const isKeepAlive = (vnode: VNode): boolean =>
  (vnode.type as any).__isKeepAlive

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
export const RouterView = (RouterViewImpl as any) as {
  new (): {
    $props: VNodeProps & RouterViewProps
  }
}
